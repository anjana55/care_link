/**
 * Signing in, for every client of the API: the public site and the mobile
 * app. The token rules here are security rules, which is why there is one
 * copy of them - an app that accepted a staff token would show a staff
 * member a client's screens, so the allowlist must not drift between apps.
 *
 * Pure functions only (no storage, no network): the shared root entry is
 * compiled for apps/api too. `atob` is global in browsers, Node 16+ and
 * React Native's Hermes engine.
 */

/** What every sign-in endpoint returns. */
export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * The sign-in screens, and the accounts each one serves. A login says which
 * screen it came from (`portal` on POST /auth/login) and the API refuses
 * credentials that belong to another one with the same "Invalid credentials"
 * as a wrong password. apps/api's common/auth/login-portal.ts imports this list.
 */
export const loginPortalValues = ['staff', 'caregiver', 'customer', 'employer'] as const;
export type LoginPortal = (typeof loginPortalValues)[number];

/** The portals outside the staff app: the public site's and the mobile app's sign-in screens. */
export type PublicLoginPortal = Exclude<LoginPortal, 'staff'>;

/**
 * The roles that may hold a session outside the staff app. An allowlist, not
 * "anything but patients": widening it would let an ADMIN, STAFF or VERIFIER
 * token sign someone in where there is nothing for them to see.
 */
export const publicRoleValues = ['PATIENT_GUARDIAN', 'CAREGIVER', 'EMPLOYER'] as const;
export type PublicRole = (typeof publicRoleValues)[number];

/** The signed-in person, read from the access token. */
export interface AuthUser {
  userId: string;
  /** Null for accounts that signed up with WhatsApp instead of an email address. */
  email: string | null;
  phone?: string;
  role: PublicRole;
  patientId?: string;
  caregiverId?: string;
  /** Overseas employers (international path): the organisation this login owns. */
  employerId?: string;
}

/** Google, Microsoft and Facebook - the providers an admin can switch on in Settings > Social auth. */
export const socialProviderValues = ['GOOGLE', 'MICROSOFT', 'FACEBOOK'] as const;
export type SocialProviderName = (typeof socialProviderValues)[number];

/** Which providers this deployment has switched on. */
export type SocialProviderAvailability = Record<SocialProviderName, boolean>;

/**
 * Lets the browser (or app) link one social account to a login it just
 * proved it owns - returned at the end of registration and by the
 * registration-number claim. Short-lived and single-purpose.
 */
export interface PendingLinkGrant {
  pendingToken: string;
  pendingTokenExpiresInSeconds: number;
  providers: SocialProviderAvailability;
}

/** POST /auth/register-caregiver/unified. */
export interface UnifiedCaregiverRegistration extends PendingLinkGrant {
  caregiverId: string;
  registrationNumber: string;
  message: string;
}

/**
 * POST /auth/whatsapp/request-otp. The same answer whether or not the number
 * is registered, so it can't be used to find out who is. `devOtp` only
 * outside production, when delivery is a console stub.
 */
export interface OtpRequestResult {
  message?: string;
  resendAfterSeconds: number;
  devOtp?: string;
}

/** POST /auth/whatsapp/register-caregiver and register-patient: the account exists, a code is on its way. */
export interface WhatsappRegistration {
  caregiverId?: string;
  patientId?: string;
  registrationNumber?: string;
  message: string;
  otpSent: boolean;
  resendAfterSeconds: number;
  expiresInSeconds?: number;
  devOtp?: string;
}

/** POST /auth/caregiver/claim/start. `devCode` only outside production. */
export interface ClaimStartResult {
  message: string;
  resendAfterSeconds: number;
  devCode?: string;
}

/** POST /auth/caregiver/claim/verify: the record is theirs; now link a sign-in method to it. */
export interface ClaimVerifyResult extends PendingLinkGrant {
  registrationNumber: string;
  caregiverId?: string;
  message?: string;
}

/**
 * The payload of a JWT, or null if it isn't one. UTF-8 safe: a name in
 * Sinhala or Tamil survives (bytes -> %XX -> text). Does NOT check the
 * signature - only the API can, and does on every request. This is for
 * deciding what to show, never for deciding what is allowed.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
    const json = decodeURIComponent(
      Array.from(binary, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
    );
    const payload: unknown = JSON.parse(json);
    return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Whether an access token is past its expiry, with a little slack for clock drift. */
export function isTokenExpired(token: string, slackMs = 5000, now = Date.now()): boolean {
  const exp = decodeJwtPayload(token)?.exp;
  return typeof exp === 'number' && exp * 1000 < now + slackMs;
}

const optionalString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/**
 * The signed-in person from an access token - or null for anything that may
 * not hold a session outside the staff app, including every staff role.
 */
export function decodePublicAuthUser(token: string): AuthUser | null {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.sub !== 'string') return null;
  const role = payload.role;
  if (!(publicRoleValues as readonly unknown[]).includes(role)) return null;
  return {
    userId: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    phone: optionalString(payload.phone),
    role: role as PublicRole,
    patientId: optionalString(payload.patientId),
    caregiverId: optionalString(payload.caregiverId),
    employerId: optionalString(payload.employerId),
  };
}
