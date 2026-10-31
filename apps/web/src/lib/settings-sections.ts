/**
 * The Settings tabs, and who sees each. Admin-only sections mirror ADMIN-only
 * API routes; the reference-data sections are readable by every staff role
 * (the API lets them read; only admins add to skills and languages).
 */
export interface SettingsSection {
  href: string;
  key: string;
  roles: readonly string[];
}

const ADMIN = ['ADMIN'] as const;
const ALL_STAFF = ['ADMIN', 'STAFF', 'VERIFIER'] as const;

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { href: '/settings/branding', key: 'settings.branding', roles: ADMIN },
  { href: '/settings/ai', key: 'settings.ai', roles: ADMIN },
  { href: '/settings/social-auth', key: 'settings.socialAuth', roles: ADMIN },
  { href: '/settings/whatsapp', key: 'settings.whatsapp', roles: ADMIN },
  { href: '/settings/email', key: 'settings.email', roles: ADMIN },
  { href: '/settings/billing', key: 'settings.billing', roles: ADMIN },
  { href: '/settings/ads', key: 'settings.ads', roles: ADMIN },
  { href: '/settings/analytics', key: 'settings.analytics', roles: ADMIN },
  { href: '/settings/mobile-app', key: 'settings.mobileApp', roles: ADMIN },
  { href: '/settings/skills', key: 'nav.skills', roles: ALL_STAFF },
  { href: '/settings/languages', key: 'nav.languages', roles: ALL_STAFF },
  { href: '/settings/locations', key: 'nav.locations', roles: ALL_STAFF },
  // Spreadsheet import/export: exports hold every NIC and phone number, so admins only.
  { href: '/settings/import-export', key: 'nav.dataTransfer', roles: ADMIN },
  { href: '/settings/audit-log', key: 'nav.auditLog', roles: ADMIN },
];

export function settingsSectionsFor(role: string | undefined): SettingsSection[] {
  return role ? SETTINGS_SECTIONS.filter((s) => s.roles.includes(role)) : [];
}
