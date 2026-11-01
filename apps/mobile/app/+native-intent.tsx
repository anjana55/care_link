import { config } from '@/config';
import { routeForIncoming } from '@/links/app-links';

/**
 * Every address the phone opens the app with passes through here first. A
 * link to the website (an App Link, on Android) becomes the app screen that
 * shows the same thing; the app's own addresses pass through untouched.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return routeForIncoming(path, config.appLinkHost);
  } catch {
    // Never crash the app over a link: open it as it came.
    return path;
  }
}
