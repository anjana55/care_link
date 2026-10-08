import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { and, eq } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID as uuid } from 'crypto';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  authHandoffCodes,
  caregivers,
  socialAccounts,
  users,
  type SocialProvider,
} from '../database/schema';
import { AuthService } from './auth.service';
import { WhatsappSettingsService } from '../whatsapp/whatsapp-settings.service';
import { RegisterCaregiverUnifiedDto } from './dto/register-caregiver-unified.dto';
import {
  generateRegistrationNumber,
  assertUniqueContactFields,
  selfRegisteredCaregiverValues,
} from '../caregivers/caregiver-creation.util';
import { resolveLocationRefs } from '../common/utils/location.util';
import {
  assertWhatsappNumberAvailable,
  purgeUnverifiedPhoneAccount,
} from './phone-accounts.util';
import { normalizePhone } from '../common/utils/phone.util';
import { SocialProviderRegistry } from './social/social-provider';
import { parseSocialProvider } from './social/social-settings.service';
import { socialRedirectUri } from './social/social-redirect.util';

/**
 * `typ` discriminates this from an ordinary access token. Without it any
 * caregiver's access token would be accepted here as a pending registration,
 * because they are both signed with the same secret and both carry a `sub`.
 */
const PENDING_TOKEN_TYPE = 'caregiver-social-signup';

/**
 * The `state` for a *sign-in* (as opposed to a registration). It travels through
 * the provider exactly like the pending token does, and has its own `typ` for
 * the same reason: both are signed with the access-token secret, so without a
 * discriminator one could be replayed as the other.
 */
const LOGIN_STATE_TYPE = 'caregiver-social-login';
const LOGIN_STATE_TTL = '10m';

const PENDING_TOKEN_TTL = '15m';
/**
 * Short by design: the handoff code is a bearer value sitting in browser
 * history and server logs, so it is only useful for the few seconds between the
 * callback redirecting and the frontend exchanging it.
 */
const HANDOFF_TTL_MS = 60 * 1000;

/**
 * Thrown when the provider cannot be linked to the record.
 *
 * Carries a stable `code` alongside the human-readable message. The callback
 * redirects the caregiver into the URL bar carrying only that code, and the
 * callback page turns it into a sentence in their language - so a message can
 * be reworded freely here without a string ever having to be parsed on the
 * client, and no internal detail rides along in a query string.
 */
export class SocialLinkError extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status = HttpStatus.CONFLICT,
  ) {
    super({ code, message }, status);
  }
}

/**
 * The unified caregiver registration and the Google/Microsoft/Facebook sign-in
 * that completes it.
 *
 * Deliberately a separate service from AuthService: this flow is self-contained
 * (one registration method, one linking rule) and keeping it apart means the
 * established email/password and WhatsApp paths cannot be disturbed by changes
 * here. It borrows AuthService.startSession so the session a caregiver ends up
 * with is byte-for-byte the same kind of JWT pair every other sign-in issues.
 */
@Injectable()
export class SocialAuthService {
  private readonly logger = new Logger(SocialAuthService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly authService: AuthService,
    private readonly registry: SocialProviderRegistry,
    private readonly whatsappSettings: WhatsappSettingsService,
  ) {}

  /**
   * Country code for turning a national phone number into E.164.
   *
   * Reuses the one existing source rather than a second env var: the same
   * spelling of the same number has to normalise identically wherever it is
   * written, and an admin who changes it in Settings > WhatsApp sign-in must
   * not end up with a platform that reads it two different ways. That settings
   * row self-creates from env on first read, so depending on it here is safe.
   */
  private async defaultCountryCode(): Promise<string> {
    return this.whatsappSettings.getDefaultCountryCode();
  }

  /**
   * Creates the caregiver's login and profile from one form, and hands back a
   * short-lived token that authorises exactly one thing: linking a social
   * identity to the record this call just created.
   */
  async registerCaregiver(dto: RegisterCaregiverUnifiedDto) {
    const { email, consentAccepted: _consent, ...rest } = dto;

    const countryCode = await this.defaultCountryCode();
    const phone = normalizePhone(dto.phone, countryCode);
    if (!phone) {
      throw new BadRequestException('Enter a valid phone number');
    }

    const normalisedEmail = email?.trim().toLowerCase() || null;
    if (normalisedEmail) {
      const [existing] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, normalisedEmail)).limit(1);
      if (existing) {
        throw new ConflictException('An account with this email already exists');
      }
    }

    // The form collects one number called `phone`; the caregivers table has
    // always called it primaryPhone, and every reader of that column (search,
    // the staff list, the wizard) expects it there. So the single form value is
    // written to both, and the caregiver fields are assembled the same way the
    // other two sign-up routes assemble them.
    const caregiverFields = { ...rest, primaryPhone: phone };

    const result = await this.withDuplicateGuard(() =>
      this.db.transaction(async (tx) => {
        const txDb = tx as unknown as Database;
        await purgeUnverifiedPhoneAccount(txDb, phone);
        // Three-table uniqueness: this login, a caregiver profile in any
        // spelling of the number, or a client profile. Reused verbatim from the
        // WhatsApp route - only its wording is adjusted below, since this flow
        // has nothing to do with WhatsApp.
        await this.assertPhoneAvailable(txDb, phone, countryCode);
        await assertUniqueContactFields(txDb, caregiverFields);
        const location = await resolveLocationRefs(txDb, caregiverFields);

        const userId = uuid();
        await tx.insert(users).values({
          id: userId,
          email: normalisedEmail,
          // No password on this route: the caregiver secures the account with a
          // provider immediately afterwards. validateUser rejects a row without
          // a password hash, so this account can never use email/password login.
          passwordHash: null,
          phone,
          phoneVerifiedAt: null,
          fullName: caregiverFields.fullName,
          role: 'CAREGIVER',
          isActive: true,
          emailVerifiedAt: null,
        });

        const caregiverId = uuid();
        const registrationNumber = await generateRegistrationNumber(txDb);
        await tx.insert(caregivers).values(
          selfRegisteredCaregiverValues({
            id: caregiverId,
            publicId: uuid(),
            userId,
            registrationNumber,
            fields: caregiverFields,
            location,
          }),
        );

        return { userId, caregiverId, registrationNumber };
      }),
    );

    return {
      caregiverId: result.caregiverId,
      registrationNumber: result.registrationNumber,
      message: 'Registration successful. Sign in with Google, Microsoft or Facebook to continue.',
      // Authorises exactly one social link, to the record created above, and
      // expires on its own. Carried through the provider as the OAuth `state`,
      // so it is not stored and cannot be revoked early - which is why every
      // operation it permits is idempotent and email-matched.
      pendingToken: this.signPendingToken(result.userId),
      pendingTokenExpiresInSeconds: 15 * 60,
      providers: await this.registry.available(),
    };
  }

  /**
   * The same grant the end of the registration form returns - a pending token
   * that authorises linking one provider to this login, plus which providers
   * are on. Also handed out by AccountClaimService once someone has proved,
   * with their registration number and a code, that a never-secured record is
   * theirs. The token is unchanged either way, so the provider round trip and
   * every check in completeLink apply identically to both.
   */
  async pendingLinkGrant(userId: string) {
    return {
      pendingToken: this.signPendingToken(userId),
      pendingTokenExpiresInSeconds: 15 * 60,
      providers: await this.registry.available(),
    };
  }

  private signPendingToken(userId: string) {
    return this.jwtService.sign(
      { sub: userId, typ: PENDING_TOKEN_TYPE },
      {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: PENDING_TOKEN_TTL as any,
      },
    );
  }

  /**
   * `assertWhatsappNumberAvailable` reports conflicts in WhatsApp terms. The
   * check itself is exactly right here - it already covers users, caregiver
   * profiles and client profiles across every spelling of the number - so only
   * the wording is swapped for a flow that has nothing to do with WhatsApp.
   */
  private async assertPhoneAvailable(db: Database, phone: string, countryCode: string) {
    try {
      await assertWhatsappNumberAvailable(db, phone, countryCode);
    } catch (err) {
      if (err instanceof ConflictException) {
        throw new ConflictException('An account with this phone number already exists - sign in instead');
      }
      throw err;
    }
  }

  /** Which provider buttons the frontend should render. Secret-free. */
  async getProviders() {
    return this.registry.available();
  }

  /** The consent-screen URL the browser is sent to. */
  async authorizeUrl(rawProvider: string, pendingToken: string): Promise<string> {
    const provider = parseSocialProvider(rawProvider);
    // Verified here so an expired or mistyped token fails before the caregiver
    // is sent to a provider screen they would only bounce back from.
    this.verifyPendingToken(pendingToken);
    const client = await this.registry.get(provider);
    return client.authorizeUrl(pendingToken, this.redirectUri(provider));
  }

  /**
   * The API's half of the callback. Returns the one-time code the frontend
   * trades for a session, or throws with a short machine-readable message the
   * callback page renders.
   */
  async completeLink(raw: { provider: string; code: string; pendingToken: string }) {
    // The provider arrives as a URL segment (`google`); everything below, the
    // database enum included, works with the canonical `GOOGLE`.
    const params = { ...raw, provider: parseSocialProvider(raw.provider) };
    const client = await this.registry.get(params.provider);
    const { sub: userId } = this.verifyPendingToken(params.pendingToken);

    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !user.isActive || user.role !== 'CAREGIVER') {
      throw new SocialLinkError(
        'registration_gone',
        'This registration can no longer be completed. Please register again.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const redirectUri = this.redirectUri(params.provider);
    const accessToken = await client.exchangeCode(params.code, redirectUri);
    const profile = await client.fetchProfile(accessToken);

    // --- the match rule -----------------------------------------------------
    // Case-insensitive: the address may have been stored with different casing
    // by the form, and providers are inconsistent about it too.
    if (user.email && user.email.toLowerCase() !== profile.email) {
      throw new SocialLinkError(
        'email_mismatch',
        `That ${params.provider.toLowerCase()} account uses a different email address than the one you registered with`,
      );
    }

    // One provider identity belongs to exactly one account, ever. The unique
    // index enforces this too; checking here turns a raw duplicate-key 500
    // into a message a caregiver can act on.
    const [identityTaken] = await this.db
      .select({ userId: socialAccounts.userId })
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.provider, params.provider as SocialProvider),
          eq(socialAccounts.providerAccountId, profile.accountId),
        ),
      )
      .limit(1);
    if (identityTaken && identityTaken.userId !== user.id) {
      throw new SocialLinkError(
        'already_linked',
        'That account is already linked to another user - sign in instead',
      );
    }

    const nextEmail = user.email ?? profile.email;
    const [emailTaken] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, nextEmail)).limit(1);
    if (emailTaken && emailTaken.id !== user.id) {
      throw new SocialLinkError(
        'email_taken',
        'An account with this email already exists - sign in instead',
      );
    }

    await this.db.transaction(async (tx) => {
      // Re-link is a no-op rather than an error: a caregiver who abandons the
      // provider screen and comes back through a fresh pending token lands here
      // again, and that is not a problem worth refusing them over.
      await tx
        .insert(socialAccounts)
        .values({
          id: uuid(),
          userId: user.id,
          provider: params.provider as SocialProvider,
          providerAccountId: profile.accountId,
          providerEmail: profile.email,
        })
        .onDuplicateKeyUpdate({ set: { providerEmail: profile.email } });
      await tx
        .update(users)
        .set({
          // A record created without an address adopts the provider's, which
          // the provider has verified. That is what makes "email is optional"
          // real rather than a dead end.
          email: nextEmail,
          emailVerifiedAt: new Date(),
        })
        .where(eq(users.id, user.id));
    });

    return this.issueHandoffCode(user.id);
  }

  // ------------------------------------------------------------------------
  // Returning-caregiver sign-in
  // ------------------------------------------------------------------------

  /**
   * The consent-screen URL for signing in with a provider the caregiver has
   * already linked.
   *
   * `nonce` is generated by the caregiver's browser and kept in its
   * sessionStorage. It rides through the provider inside the signed `state`
   * and comes back on the final redirect, where the callback page refuses to
   * continue unless it matches. That binds the whole round trip to the browser
   * that started it: without it, anyone could start a sign-in on their own
   * account and send the callback link to a victim, signing the victim in as
   * the attacker (login CSRF).
   */
  async loginAuthorizeUrl(rawProvider: string, nonce: string): Promise<string> {
    const provider = parseSocialProvider(rawProvider);
    if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
      throw new BadRequestException('Missing or invalid sign-in nonce');
    }
    const client = await this.registry.get(provider);
    const state = this.jwtService.sign(
      { typ: LOGIN_STATE_TYPE, nonce },
      { secret: this.config.get<string>('JWT_ACCESS_SECRET'), expiresIn: LOGIN_STATE_TTL as any },
    );
    return client.authorizeUrl(state, this.redirectUri(provider));
  }

  /**
   * Which flow a callback belongs to. Only used to pick the page a failure is
   * reported on, so anything unreadable is treated as a registration - that
   * page's "back" link is the safe default.
   */
  flowOf(state: string | undefined): 'login' | 'signup' {
    if (!state) return 'signup';
    try {
      const payload = this.jwtService.verify(state, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      }) as { typ?: string };
      return payload.typ === LOGIN_STATE_TYPE ? 'login' : 'signup';
    } catch {
      return 'signup';
    }
  }

  /**
   * The single entry point for the provider callback: routes on the `state`'s
   * type, so one registered redirect URI per provider serves both flows and
   * nothing new has to be registered with Google, Microsoft or Facebook.
   */
  async completeCallback(params: { provider: string; code: string; state: string }) {
    if (this.flowOf(params.state) === 'login') {
      return { flow: 'login' as const, ...(await this.completeLogin(params)) };
    }
    const handoffCode = await this.completeLink({
      provider: params.provider,
      code: params.code,
      pendingToken: params.state,
    });
    return { flow: 'signup' as const, handoffCode };
  }

  /**
   * Signs a caregiver in with a provider identity they linked at registration.
   *
   * The lookup key is the provider's stable account id, never the email: an
   * address can be changed or reassigned at the provider, and matching on it
   * would let whoever ends up owning an old address walk into the account. It
   * also means this never creates anything - a provider account nobody linked
   * is told to register, rather than being silently given a profile.
   */
  private async completeLogin(raw: { provider: string; code: string; state: string }) {
    const params = { ...raw, provider: parseSocialProvider(raw.provider) };
    const client = await this.registry.get(params.provider);
    const { nonce } = this.verifyLoginState(params.state);

    const accessToken = await client.exchangeCode(params.code, this.redirectUri(params.provider));
    const profile = await client.fetchProfile(accessToken);

    const [link] = await this.db
      .select({ userId: socialAccounts.userId })
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.provider, params.provider as SocialProvider),
          eq(socialAccounts.providerAccountId, profile.accountId),
        ),
      )
      .limit(1);
    if (!link) {
      throw new SocialLinkError(
        'not_registered',
        'No caregiver account is linked to that sign-in. Register first.',
        HttpStatus.NOT_FOUND,
      );
    }

    const [user] = await this.db.select().from(users).where(eq(users.id, link.userId)).limit(1);
    // Same two conditions completeLink and the exchange enforce: the provider
    // proving who someone is does not make a disabled account, or a non-caregiver
    // one, signable here.
    if (!user || !user.isActive || user.role !== 'CAREGIVER') {
      throw new SocialLinkError(
        'account_disabled',
        'This account cannot be used to sign in.',
        HttpStatus.FORBIDDEN,
      );
    }

    return { handoffCode: await this.issueHandoffCode(user.id), nonce };
  }

  private verifyLoginState(state: string): { nonce: string } {
    try {
      const payload = this.jwtService.verify(state, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      }) as { typ?: string; nonce?: string };
      if (payload.typ !== LOGIN_STATE_TYPE || !payload.nonce) {
        throw new Error('wrong token type');
      }
      return { nonce: payload.nonce };
    } catch {
      throw new SocialLinkError('expired', 'This sign-in link has expired. Please try again.', HttpStatus.UNAUTHORIZED);
    }
  }

  /** Trades a one-time handoff code for the same JWT pair every login issues. */
  async exchangeHandoffCode(code: string) {
    if (!code) {
      throw new BadRequestException('Missing sign-in code');
    }
    const codeHash = this.hashToken(code);
    const [record] = await this.db
      .select()
      .from(authHandoffCodes)
      .where(eq(authHandoffCodes.codeHash, codeHash))
      .limit(1);

    // One message for every way this can fail - unknown, already spent, or
    // expired - so the callback page cannot be used to probe which is which.
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('This sign-in link has expired. Please try again.');
    }

    await this.db.update(authHandoffCodes).set({ usedAt: new Date() }).where(eq(authHandoffCodes.id, record.id));

    const [user] = await this.db.select().from(users).where(eq(users.id, record.userId)).limit(1);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account is disabled or no longer exists');
    }
    // The reuse point AuthService documents for exactly this: a user another
    // method authenticated gets the identical session an email or WhatsApp
    // login would have produced.
    return this.authService.startSession(user);
  }

  private async issueHandoffCode(userId: string) {
    const code = randomBytes(32).toString('hex');
    await this.db.insert(authHandoffCodes).values({
      id: uuid(),
      userId,
      codeHash: this.hashToken(code),
      expiresAt: new Date(Date.now() + HANDOFF_TTL_MS),
    });
    return code;
  }

  /**
   * The registered redirect URI for a provider. Must match the authorize call
   * byte for byte or the provider rejects the token exchange, so both go
   * through here (and the settings screen shows the same value).
   */
  redirectUri(provider: string) {
    return socialRedirectUri(this.config, parseSocialProvider(provider));
  }

  private publicWebUrl() {
    return this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3002';
  }

  private verifyPendingToken(token: string): { sub: string } {
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      }) as { sub?: string; typ?: string };
      // The type check is what stops an ordinary caregiver access token being
      // replayed here to link a provider identity to an arbitrary account.
      if (payload.typ !== PENDING_TOKEN_TYPE || !payload.sub) {
        throw new Error('wrong token type');
      }
      return { sub: payload.sub };
    } catch {
      throw new SocialLinkError(
        'expired',
        'This registration link has expired. Please register again.',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private async withDuplicateGuard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } };
      if (e.code === 'ER_DUP_ENTRY' || e.cause?.code === 'ER_DUP_ENTRY') {
        throw new ConflictException('An account with this phone number already exists - sign in instead');
      }
      throw err;
    }
  }
}