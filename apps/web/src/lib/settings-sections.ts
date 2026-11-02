/**
 * The Settings sections, in groups, and who sees each. Admin-only sections
 * mirror ADMIN-only API routes; the reference-data sections are readable by
 * every staff role (the API lets them read; only admins add to skills and
 * languages).
 *
 * Grouped so the menu reads as a short list of topics rather than one long
 * strip of tabs (which ran past the window). Languages share a page with
 * skills and analytics with ads; their old addresses redirect.
 */
export interface SettingsSection {
  href: string;
  key: string;
  roles: readonly string[];
}

export interface SettingsGroup {
  key: string;
  sections: readonly SettingsSection[];
}

const ADMIN = ['ADMIN'] as const;
const ALL_STAFF = ['ADMIN', 'STAFF', 'VERIFIER'] as const;

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    key: 'settings.groups.brand',
    sections: [
      { href: '/settings/branding', key: 'settings.branding', roles: ADMIN },
      { href: '/settings/mobile-app', key: 'settings.mobileApp', roles: ADMIN },
    ],
  },
  {
    key: 'settings.groups.signInMessaging',
    sections: [
      { href: '/settings/social-auth', key: 'settings.socialAuth', roles: ADMIN },
      { href: '/settings/whatsapp', key: 'settings.whatsapp', roles: ADMIN },
      { href: '/settings/email', key: 'settings.email', roles: ADMIN },
    ],
  },
  {
    key: 'settings.groups.services',
    sections: [
      { href: '/settings/billing', key: 'settings.billing', roles: ADMIN },
      { href: '/settings/ai', key: 'settings.ai', roles: ADMIN },
      { href: '/settings/ads', key: 'settings.adsAnalytics', roles: ADMIN },
    ],
  },
  {
    key: 'settings.groups.referenceData',
    sections: [
      { href: '/settings/skills', key: 'settings.skillsLanguages', roles: ALL_STAFF },
      { href: '/settings/locations', key: 'nav.locations', roles: ALL_STAFF },
    ],
  },
  {
    key: 'settings.groups.data',
    sections: [
      // Spreadsheet import/export: exports hold every NIC and phone number, so admins only.
      { href: '/settings/import-export', key: 'nav.dataTransfer', roles: ADMIN },
      { href: '/settings/audit-log', key: 'nav.auditLog', roles: ADMIN },
    ],
  },
];

export const SETTINGS_SECTIONS: readonly SettingsSection[] = SETTINGS_GROUPS.flatMap((g) => g.sections);

/** Addresses that moved into another section's page, so the right menu item is still highlighted. */
const MERGED: Record<string, string> = {
  '/settings/languages': '/settings/skills',
  '/settings/analytics': '/settings/ads',
};

export function sectionHrefFor(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  for (const [from, to] of Object.entries(MERGED)) if (pathname.startsWith(from)) return to;
  return SETTINGS_SECTIONS.find((s) => pathname.startsWith(s.href))?.href ?? null;
}

export function settingsGroupsFor(role: string | undefined): SettingsGroup[] {
  if (!role) return [];
  return SETTINGS_GROUPS.map((g) => ({ ...g, sections: g.sections.filter((s) => s.roles.includes(role)) })).filter((g) => g.sections.length > 0);
}

export function settingsSectionsFor(role: string | undefined): SettingsSection[] {
  return settingsGroupsFor(role).flatMap((g) => g.sections);
}
