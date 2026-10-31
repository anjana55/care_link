/**
 * A screen in a tab group that has no tab button of its own - opened from
 * another screen (Documents from Me, Saved and Invoices from My account).
 *
 * Not `href: null`: since SDK 58 that hides the route itself, and the router
 * sends anyone going there straight back to where they were. This hides only
 * the button, so the screen can still be opened.
 */
export const HIDDEN_TAB = { tabBarButton: () => null, tabBarItemStyle: { display: 'none' as const } };
