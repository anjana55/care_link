import { BadRequestException, Injectable } from '@nestjs/common';
import { socialProviderEnum, type SocialProvider } from '../../database/schema';
import { parseSocialProvider, SocialAuthSettingsService, type ResolvedProviderConfig } from './social-settings.service';

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
  /**
   * Asks the provider's token endpoint to authenticate this client with a code
   * that cannot be valid, and reports whether the *client* was accepted.
   */
  probeCredentials(redirectUri: string): Promise<CredentialCheck>;
}

/** Outcome of an admin's "test credentials" click. `message` never echoes provider text. */
export interface CredentialCheck {
  ok: boolean;
  message: string;
}

/** A deliberately invalid code: the provider must reject it, and *how* it rejects tells us about the client. */
const PROBE_CODE = 'carelink-credential-check';

async function rawPost(url: string, body: Record<string, string>): Promise<{ status: number; json: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  return { status: res.status, json: text ? safeParse(text) : {} };
}

const unreachable: CredentialCheck = { ok: false, message: 'Could not reach the provider. Check the server\'s internet access and try again.' };
const accepted = (name: string): CredentialCheck => ({
  ok: true,
  message: `${name} did not reject the client ID and secret. (The sign-in itself is only exercised by a real sign-in.)`,
});
const rejected = (name: string, what: string): CredentialCheck => ({
  ok: false,
  message: `${name} rejected ${what}. Check it against the provider's console.`,
});

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
export class GoogleProviderClient implements SocialProviderClient {
  readonly provider = 'GOOGLE' as const;
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(cfg: ResolvedProviderConfig) {
    this.clientId = cfg.clientId ?? '';
    this.clientSecret = cfg.clientSecret ?? '';
  }

  authorizeUrl(state: string, redirectUri: string) {
    const params = new URLSearchParams({
      client_id: this.clientId,
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
      client_id: this.clientId,
      client_secret: this.clientSecret,
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

  async probeCredentials(redirectUri: string): Promise<CredentialCheck> {
    try {
      const { json } = await rawPost('https://oauth2.googleapis.com/token', {
        code: PROBE_CODE,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });
      // A good client is told the *code* is bad (invalid_grant); a bad one is
      // told it is not a client at all (invalid_client).
      if (json?.error === 'invalid_client') return rejected('Google', 'the client ID or secret');
      if (json?.error === 'invalid_grant') return accepted('Google');
      return { ok: false, message: 'Google returned an unexpected answer. Check the client ID and secret.' };
    } catch {
      return unreachable;
    }
  }
}

/** Microsoft Entra ID (Azure AD) v2 endpoint, `openid email profile` scopes. */
export class MicrosoftProviderClient implements SocialProviderClient {
  readonly provider = 'MICROSOFT' as const;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly tenant: string;

  constructor(cfg: ResolvedProviderConfig) {
    this.clientId = cfg.clientId ?? '';
    this.clientSecret = cfg.clientSecret ?? '';
    this.tenant = cfg.tenant;
  }

  private base() {
    return `https://login.microsoftonline.com/${encodeURIComponent(this.tenant)}/oauth2/v2.0`;
  }

  authorizeUrl(state: string, redirectUri: string) {
    const params = new URLSearchParams({
      client_id: this.clientId,
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
      client_id: this.clientId,
      client_secret: this.clientSecret,
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

  async probeCredentials(redirectUri: string): Promise<CredentialCheck> {
    try {
      const { json } = await rawPost(`${this.base()}/token`, {
        code: PROBE_CODE,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: 'openid email profile',
      });
      const codes: number[] = Array.isArray(json?.error_codes) ? json.error_codes : [];
      // 700016: no such application in this tenant. 7000215 / 7000222: wrong or
      // expired secret. 90002 / 90023: unknown tenant. All say the *client* is bad.
      if (codes.includes(700016)) return rejected('Microsoft', 'the application (client) ID');
      if (codes.includes(7000215) || codes.includes(7000222) || json?.error === 'invalid_client') {
        return rejected('Microsoft', 'the client secret');
      }
      if (codes.includes(90002) || codes.includes(90023)) return rejected('Microsoft', 'the tenant');
      if (json?.error) return accepted('Microsoft');
      return { ok: false, message: 'Microsoft returned an unexpected answer. Check the client ID and secret.' };
    } catch {
      return unreachable;
    }
  }
}

/** Facebook Login: `email` scope so the address is returned, `id` is the key. */
export class FacebookProviderClient implements SocialProviderClient {
  readonly provider = 'FACEBOOK' as const;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly apiVersion: string;

  constructor(cfg: ResolvedProviderConfig) {
    this.clientId = cfg.clientId ?? '';
    this.clientSecret = cfg.clientSecret ?? '';
    this.apiVersion = cfg.apiVersion;
  }

  authorizeUrl(state: string, redirectUri: string) {
    const params = new URLSearchParams({
      client_id: this.clientId,
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
      client_id: this.clientId,
      client_secret: this.clientSecret,
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

  async probeCredentials(redirectUri: string): Promise<CredentialCheck> {
    try {
      const { json } = await rawPost(`https://graph.facebook.com/${this.apiVersion}/oauth/access_token`, {
        code: PROBE_CODE,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri,
      });
      const message = String(json?.error?.message ?? '').toLowerCase();
      const code = Number(json?.error?.code);
      if (message.includes('client secret')) return rejected('Facebook', 'the app secret');
      if (code === 101 || message.includes('app id') || message.includes('application')) {
        return rejected('Facebook', 'the app ID');
      }
      if (json?.error) return accepted('Facebook');
      return { ok: false, message: 'Facebook returned an unexpected answer. Check the app ID and secret.' };
    } catch {
      return unreachable;
    }
  }
}

/**
 * Looks a provider up by name and builds a client from the admin-managed
 * settings, which are read on every call so an admin's change applies at once.
 *
 * A provider counts as available only when it is switched on AND has both a
 * client id and a secret - so a half-finished configuration hides the button
 * instead of offering a sign-in that fails.
 */
@Injectable()
export class SocialProviderRegistry {
  constructor(private readonly settings: SocialAuthSettingsService) {}

  static build(cfg: ResolvedProviderConfig): SocialProviderClient {
    switch (cfg.provider) {
      case 'GOOGLE':
        return new GoogleProviderClient(cfg);
      case 'MICROSOFT':
        return new MicrosoftProviderClient(cfg);
      case 'FACEBOOK':
        return new FacebookProviderClient(cfg);
    }
  }

  /** The client for a usable provider. Accepts any casing, since it comes from a URL segment. */
  async get(provider: string): Promise<SocialProviderClient> {
    const name = parseSocialProvider(provider);
    const cfg = await this.settings.getResolved(name);
    if (!cfg.usable) {
      throw new BadRequestException(`${name} sign-in is not available right now`);
    }
    return SocialProviderRegistry.build(cfg);
  }

  /** Which buttons the frontend should render, keyed by provider. */
  async available(): Promise<Record<SocialProvider, boolean>> {
    const out = Object.fromEntries(socialProviderEnum.map((p) => [p, false])) as Record<SocialProvider, boolean>;
    for (const cfg of await this.settings.getAllResolved()) out[cfg.provider] = cfg.usable;
    return out;
  }

  /** True when at least one provider is usable - guards a dead-end screen. */
  async anyAvailable(): Promise<boolean> {
    return Object.values(await this.available()).some(Boolean);
  }
}
