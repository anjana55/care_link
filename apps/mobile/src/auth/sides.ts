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
 * Where a signed-in person's area starts: clients on Find, caregivers on their
 * home (today's shift, from Phase 3). Anyone else isn't signed in to the app.
 */
export const homeFor = (user: { role: string } | null | undefined): '/find' | '/home' =>
  user?.role === 'CAREGIVER' ? '/home' : '/find';

/**
 * Where to go after signing in: back to `returnTo` (the profile someone was
 * looking at when they tapped Contact) if it's a path inside the app, else
 * their area. Never another site: only "/..." and not "//...".
 */
export function afterSignIn(user: { role: string }, returnTo: unknown): string {
  const back = typeof returnTo === 'string' && /^\/(?!\/)/.test(returnTo) ? returnTo : null;
  return back && user.role !== 'CAREGIVER' ? back : homeFor(user);
}
