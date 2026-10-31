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
