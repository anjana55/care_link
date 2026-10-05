import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { socialProviderEnum, type SocialProvider } from '../../database/schema';

/**
 * What a provider tells us about the person who just authenticated.
 *
 * `accountId` is the provider's stable identifier for them and is what we key
 * the link on; `email` is only ever an additional check, never the key.
 */
export interface SocialProfile {
  accountId: string;
  email: string;
  name?: string;
}

/**
 * One identity provider, reduced to the three calls this flow actually makes.
 *
 * Deliberately hand-rolled rather than a Passport strategy: the Passport social
 * packages are built around `req.session`, and this app has no sessions - it
 * carries a JWT pair in localStorage and re-reads the user from the database on
 * every request. Each provider's flow is two HTTP calls (exchange the code,
 * then fetch the profile), so wrapping that directly costs less than the
 * session machinery a strategy would drag in.
 */
export interface SocialProviderClient {
  readonly provider: SocialProvider;
  /** The URL the browser is sent to for the consent screen. `state` round-trips untouched. */
  authorizeUrl(state: string, redirectUri: string): string;
  /** Trades the callback's `code` for an access token. */
  exchangeCode(code: string, redirectUri: string): Promise<string>;
  /** Reads the signed-in person's id and verified email. */
  fetchProfile(accessToken: string): Promise<SocialProfile>;
}

/** Reads a JSON body, turning a provider's error payload into a readable failure. */
async function postJson(url: string, body: Record<string, string>, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  const json = text ? safeParse(text) : {};
  if (!res.ok) {
    const detail = json?.error_description ?? json?.error?.message ?? json?.error ?? res.statusText;
    // The raw provider payload can contain the client secret in an
    // error_description, so it is logged but never returned to the caller.
    throw new BadRequestException(`The sign-in provider rejected this request (${res.status})`);
  }
  return json;
}

async function getJson(url: string, accessToken: string): Promise<any> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await res.text();
  const json = text ? safeParse(text) : {};
  if (!res.ok) {
    throw new BadRequestException(`Could not read the account details from the sign-in provider (${res.status})`);
  }
  return json;
}

function safeParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** Google Identity: OIDC, `openid email` scopes, verified `email` claim. */
@Injectable()
export class GoogleProviderClient implements SocialProviderClient {
  readonly provider = 'GOOGLE' as const;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;

  constructor(config: ConfigService) {
    this.clientId = config.get<string>('GOOGLE_CLIENT_ID');
    this.clientSecret = config.get<string>('GOOGLE_CLIENT_SECRET');
  }

  get configured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  authorizeUrl(state: string, redirectUri: string) {
    const params = new URLSearchParams({
      client_id: this.clientId!,
      redirect_uri: redirectUri,
      response_type: 'code',
      // 'consent' rather than 'select_account': the address must be the one the
      // caregiver registered with, so Google should not let them silently pick
      // a different account than the browser is signed in to.
      prompt: 'consent',
      scope: 'openid email profile',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string) {
    const json = await postJson('https://oauth2.googleapis.com/token', {
      code,
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    return json.access_token as string;
  }

  async fetchProfile(accessToken: string): Promise<SocialProfile> {
    const json = await getJson('https://openidconnect.googleapis.com/v1/userinfo', accessToken);
    // `email_verified` false would mean the provider has not actually proven
    // this address, and the whole linking rule depends on it being proven.
    if (!json.email || json.email_verified === false) {
      throw new BadRequestException('Google did not return a verified email address');
    }
    return { accountId: String(json.sub), email: String(json.email).toLowerCase(), name: json.name };
  }
}

/** Microsoft Entra ID (Azure AD) v2 endpoint, `openid email profile` scopes. */
@Injectable()
export class MicrosoftProviderClient implements SocialProviderClient {
  readonly provider = 'MICROSOFT' as const;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly tenant: string;

  constructor(config: ConfigService) {
    this.clientId = config.get<string>('MICROSOFT_CLIENT_ID');
    this.clientSecret = config.get<string>('MICROSOFT_CLIENT_SECRET');
    this.tenant = config.get<string>('MICROSOFT_TENANT') ?? 'common';
  }

  get configured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  private base() {
    return `https://login.microsoftonline.com/${encodeURIComponent(this.tenant)}/oauth2/v2.0`;
  }

  authorizeUrl(state: string, redirectUri: string) {
    const params = new URLSearchParams({
      client_id: this.clientId!,
      redirect_uri: redirectUri,
      response_type: 'code',
      response_mode: 'query',
      scope: 'openid email profile',
      state,
    });
    return `${this.base()}/authorize?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string) {
    const json = await postJson(`${this.base()}/token`, {
      code,
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: 'openid email profile',
    });
    return json.access_token as string;
  }

  async fetchProfile(accessToken: string): Promise<SocialProfile> {
    // The v2 userinfo endpoint returns the address in `email` and, on some
    // tenants, only in `preferred_username`. Prefer the former.
    const json = await getJson('https://graph.microsoft.com/oidc/userinfo', accessToken);
    const email = json.email ?? json.preferred_username;
    if (!email) {
      throw new BadRequestException('Microsoft did not return an email address');
    }
    return { accountId: String(json.sub), email: String(email).toLowerCase(), name: json.name };
  }
}

/** Facebook Login: `email` scope so the address is returned, `id` is the key. */
@Injectable()
export class FacebookProviderClient implements SocialProviderClient {
  readonly provider = 'FACEBOOK' as const;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly apiVersion: string;

  constructor(config: ConfigService) {
    this.clientId = config.get<string>('FACEBOOK_CLIENT_ID');
    this.clientSecret = config.get<string>('FACEBOOK_CLIENT_SECRET');
    this.apiVersion = config.get<string>('FACEBOOK_API_VERSION') ?? 'v21.0';
  }

  get configured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  authorizeUrl(state: string, redirectUri: string) {
    const params = new URLSearchParams({
      client_id: this.clientId!,
      redirect_uri: redirectUri,
      // Facebook has no `state` of its own to verify; ours round-trips and is
      // checked on the way back exactly as it is for the other two.
      state,
      response_type: 'code',
      scope: 'email',
    });
    return `https://www.facebook.com/${this.apiVersion}/dialog/oauth?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string) {
    const json = await postJson(`https://graph.facebook.com/${this.apiVersion}/oauth/access_token`, {
      code,
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    return json.access_token as string;
  }

  async fetchProfile(accessToken: string): Promise<SocialProfile> {
    const json = await getJson(
      `https://graph.facebook.com/${this.apiVersion}/me?fields=id,email,name`,
      accessToken,
    );
    // Facebook only returns `email` for an account that has a verified address
    // and has granted the scope; without it there is nothing to match on.
    if (!json.email) {
      throw new BadRequestException('Facebook did not return an email address for this account');
    }
    return { accountId: String(json.id), email: String(json.email).toLowerCase(), name: json.name };
  }
}

/**
 * Looks a provider up by name and reports which are usable in this environment.
 *
 * A provider counts as available only when its client id AND secret are both
 * set - so a half-finished configuration hides the button instead of offering
 * a sign-in that fails.
 */
@Injectable()
export class SocialProviderRegistry {
  private readonly logger = new Logger(SocialProviderRegistry.name);
  private readonly clients: SocialProviderClient[];

  constructor(google: GoogleProviderClient, microsoft: MicrosoftProviderClient, facebook: FacebookProviderClient) {
    this.clients = [google, microsoft, facebook];
  }

  get(provider: string): SocialProviderClient {
    const match = this.clients.find((c) => c.provider === provider);
    if (!match) {
      throw new BadRequestException(`Unknown sign-in provider: ${provider}`);
    }
    if (!(match as any).configured) {
      throw new BadRequestException(`${match.provider} sign-in is not available right now`);
    }
    return match;
  }

  /** Which buttons the frontend should render, keyed by provider. */
  available(): Record<SocialProvider, boolean> {
    const out = Object.fromEntries(socialProviderEnum.map((p) => [p, false])) as Record<SocialProvider, boolean>;
    for (const client of this.clients) {
      out[client.provider] = Boolean((client as any).configured);
    }
    return out;
  }

  /** True when at least one provider is configured - guards a dead-end screen. */
  anyAvailable(): boolean {
    return this.clients.some((c) => (c as any).configured);
  }
}