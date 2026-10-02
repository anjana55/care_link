'use client';

import Link from 'next/link';
import { Mail, MessageCircle } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { useWhatsappConfig } from '@/lib/hooks/use-whatsapp-config';

/**
 * The caregiver entry point, and the target of the landing page's
 * "Join as a caregiver" button.
 *
 * This used to live under the `/staff` basePath in the apps/web container,
 * which is where office staff sign in. Caregivers are a different audience
 * from office staff, so their sign-up belongs on the public site next to the
 * patient one at /register - not behind a staff login.
 *
 * Two routes rather than one form because the two flows differ after the
 * first field: the email path collects a password and ends on a
 * verify-your-email step, while the WhatsApp path collects a number and ends
 * in an OTP. Same split the patient pages use.
 */
export default function CaregiverJoinPage() {
  const { t } = useTranslation();
  const { data: whatsapp } = useWhatsappConfig();

  // A failed or empty config must not take the email option down with it, so
  // this only ever hides the WhatsApp card - it never blocks the page.
  const whatsappAvailable = Boolean(whatsapp?.caregiver.register);

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <SiteHeader maxWidth="3xl" />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            {t('caregiverRegister.join.title')}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-ink/60">{t('caregiverRegister.join.subtitle')}</p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <Link
            href="/caregiver/register"
            className="group flex flex-col gap-3 rounded-lg border border-border bg-white p-6 transition-all hover:-translate-y-0.5 hover:border-brand hover:shadow-lg"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded bg-brand-light text-brand-dark">
              <Mail className="h-5 w-5" aria-hidden />
            </span>
            <h2 className="text-base font-semibold text-ink">{t('caregiverRegister.join.emailTitle')}</h2>
            <p className="flex-1 text-sm text-ink/60">{t('caregiverRegister.join.emailBody')}</p>
            <span className="text-sm font-semibold text-brand transition-colors group-hover:text-brand-dark">
              {t('caregiverRegister.join.emailCta')}
            </span>
          </Link>

          {whatsappAvailable ? (
            <Link
              href="/caregiver/register/whatsapp"
              className="group flex flex-col gap-3 rounded-lg border border-border bg-white p-6 transition-all hover:-translate-y-0.5 hover:border-brand hover:shadow-lg"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded bg-brand-light text-brand-dark">
                <MessageCircle className="h-5 w-5" aria-hidden />
              </span>
              <h2 className="text-base font-semibold text-ink">{t('caregiverRegister.join.whatsappTitle')}</h2>
              <p className="flex-1 text-sm text-ink/60">{t('caregiverRegister.join.whatsappBody')}</p>
              <span className="text-sm font-semibold text-brand transition-colors group-hover:text-brand-dark">
                {t('caregiverRegister.join.whatsappCta')}
              </span>
            </Link>
          ) : (
            /*
              Rendered as a dead card rather than hidden. A caregiver who has
              been told about WhatsApp sign-up elsewhere on the site should be
              able to see that it exists and why it is not offered right now,
              rather than finding one option where the site promised two.
            */
            <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border bg-white/60 p-6">
              <span className="flex h-11 w-11 items-center justify-center rounded bg-paper text-ink/40">
                <MessageCircle className="h-5 w-5" aria-hidden />
              </span>
              <h2 className="text-base font-semibold text-ink/60">{t('caregiverRegister.join.whatsappTitle')}</h2>
              <p className="flex-1 text-sm text-ink/50">{t('caregiverRegister.join.whatsappUnavailable')}</p>
            </div>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}