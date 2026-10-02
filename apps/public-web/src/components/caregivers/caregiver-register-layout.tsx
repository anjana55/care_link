'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';

/**
 * Shared chrome for the two caregiver sign-up forms.
 *
 * These pages were ported separately and immediately drifted: the email one
 * offered the WhatsApp route under its subtitle, the WhatsApp one offered the
 * email route at the bottom of the form, and their terminal states used
 * different page furniture. Both now render through this module, so a change
 * to one cannot leave the other behind.
 *
 * Declared at module level on purpose. Declared inside a page component it
 * would be a new component type on every render, remounting the form and
 * dropping whatever the visitor had typed.
 */
export function CaregiverRegisterShell({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <SiteHeader maxWidth={narrow ? 'sm' : '3xl'} />
      <main className="mx-auto w-full flex-1 px-4 py-10">
        <div className={`mx-auto ${narrow ? 'max-w-sm' : 'max-w-3xl'}`}>{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}

/**
 * Title, subtitle, and the link to the other sign-up route.
 *
 * `children` is the cross-link, and it is expected to be omitted rather than
 * moved when the alternate route does not exist - which is the only reason
 * the two pages differ here at all: WhatsApp sign-up can be switched off per
 * environment, email sign-up cannot.
 */
export function CaregiverRegisterHeader({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  return (
    <div className="mb-6 text-center">
      <h1 className="text-lg font-semibold text-ink">{title}</h1>
      <p className="text-sm text-ink/60">{subtitle}</p>
      {children}
    </div>
  );
}

/**
 * The one-line "use the other route instead" affordance, styled identically on
 * both pages and always sitting directly under the subtitle.
 */
export function CaregiverRegisterAlternate({ href, linkText, prefix }: { href: string; linkText: string; prefix?: string }) {
  return (
    <p className="mt-2 text-sm text-ink/60">
      {prefix ? `${prefix} ` : null}
      <Link href={href} className="font-medium text-brand-dark hover:underline">
        {linkText}
      </Link>
    </p>
  );
}
