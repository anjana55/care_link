'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/provider';
import { AuthHeader } from '@/components/layout/brand-mark';

/**
 * Old verification links land here (/staff/verify-email). Verification is the
 * public site's job now: caregivers and clients sign in and work there, and
 * verifying here signed caregivers into this app instead, leaving them signed
 * out on the site they actually use (and the second request from this page
 * then failed the already-used link). So this page only hands the link on,
 * token and all, without using it.
 *
 * The public site is this origin's root in production (nginx); set
 * NEXT_PUBLIC_PUBLIC_SITE_URL where it lives elsewhere (local dev: :3002).
 */
const PUBLIC_SITE = (process.env.NEXT_PUBLIC_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '');

function ForwardToPublicSite() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get('token');
    window.location.replace(`${PUBLIC_SITE}/verify-email${token ? `?token=${encodeURIComponent(token)}` : ''}`);
  }, [searchParams]);

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <AuthHeader />
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <p className="text-sm text-ink/60">{t('verifyEmail.verifying')}</p>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <ForwardToPublicSite />
    </Suspense>
  );
}
