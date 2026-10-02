'use client';

import Link from 'next/link';
import { useTranslation } from '@/lib/i18n/provider';
import { AuthHeader } from '@/components/layout/brand-mark';

export default function NotFound() {
  const { t, fontClass } = useTranslation();

  return (
    <div className={`flex min-h-screen flex-col bg-paper ${fontClass}`}>
      <AuthHeader />
      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-sm text-center">
          <p className="mb-2 text-5xl font-bold text-brand/30">404</p>
          <h1 className="mb-2 text-lg font-semibold text-ink">{t('notFound.title')}</h1>
          <p className="mb-6 text-sm text-ink/60">{t('notFound.body')}</p>
          <div className="flex flex-col items-center gap-3">
            <Link
              href="/dashboard"
              className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
            >
              {t('notFound.home')}
            </Link>
            <a href="/" className="text-sm font-medium text-brand-dark hover:underline">
              {t('notFound.public')}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}