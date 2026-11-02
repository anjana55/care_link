import type { PublicLoginPortal } from '@care-platform/shared';
import { config } from '@/config';

/**
 * The two sides of the app. The side decides which sign-in `portal` the API is
 * told - it refuses a caregiver's credentials on the client screen and the
 * reverse, with the same answer as a wrong password - and where to register.
 */
export type Side = 'client' | 'caregiver';

export const sideFrom = (value: unknown): Side => (value === 'caregiver' ? 'caregiver' : 'client');

export const portalFor = (side: Side): PublicLoginPortal => (side === 'caregiver' ? 'caregiver' : 'customer');

/** Registration happens on the website until the app has its own forms. */
export const registerUrl = (side: Side): string =>
  `${config.siteUrl}${side === 'caregiver' ? '/caregiver/join' : '/register'}`;

/**
 * Where a signed-in person's area starts - what the Home button opens: clients
 * on their home of big tiles (Start), caregivers on Today.
 */
export const homeFor = (user: { role: string } | null | undefined): '/start' | '/home' =>
  user?.role === 'CAREGIVER' ? '/home' : '/start';

/** The caregiver side's screens; everything else is the client side's. */
export const CAREGIVER_SCREENS = ['/home', '/shifts', '/payments', '/me', '/documents', '/profile'] as const;
export type CaregiverScreen = (typeof CAREGIVER_SCREENS)[number];
const isCaregiverScreen = (path: string) => (CAREGIVER_SCREENS as readonly string[]).includes(path);

/**
 * Where to go after signing in: back to `returnTo` - the profile someone was
 * looking at when they tapped Contact, or the screen a link opened - if it's
 * a path inside the app on this person's side, else their area. Never another
 * site: only "/..." and not "//...".
 */
export function afterSignIn(user: { role: string }, returnTo: unknown): string {
  const back = typeof returnTo === 'string' && /^\/(?!\/)/.test(returnTo) ? returnTo : null;
  if (!back) return homeFor(user);
  return isCaregiverScreen(back) === (user.role === 'CAREGIVER') ? back : homeFor(user);
}

/**
 * Who may see a caregiver screen: someone not signed in is sent to the
 * caregiver sign-in, which brings them back here (a link from an email can
 * open any of these); a client goes to their own area. Null: stay.
 */
export function caregiverOnly(user: { role: string } | null | undefined, here: CaregiverScreen) {
  if (!user) return { pathname: '/sign-in', params: { role: 'caregiver', returnTo: here } } as const;
  if (user.role !== 'CAREGIVER') return '/start' as const;
  return null;
}
