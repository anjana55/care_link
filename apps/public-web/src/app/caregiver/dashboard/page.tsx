'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useTranslation } from '@/lib/i18n';
import { useAuth } from '@/lib/api/auth-context';
import { Button } from '@/components/ui/button';

/**
 * The caregiver's own private page - deliberately a stub.
 *
 * Its content comes later; what exists here is the destination the sign-in flow
 * lands on, so that "registered caregivers are logged in to their own private
 * page" is true end to end today rather than pointing at a page that does not
 * exist.
 *
 * It lives in this container rather than the /staff one because of the token
 * key split documented in the plan: the two apps are served from one origin but
 * write their JWT pair under different localStorage keys, so a handoff into
 * /staff would land signed out.
 */
export default function CaregiverDashboardPage() {
  const { t } = useTranslation();
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // The session is read from localStorage, so on first render `loading` is
    // still true and `user` is not yet decided. Sending an anonymous visitor
    // to a login page they did not ask for is worse than one frame of content.
    if (!loading && !user) router.replace('/caregiver/login');
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <p className="text-sm text-ink/60">{t('common.loading')}</p>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-white p-6 text-center">
        <h1 className="text-lg font-semibold text-ink">
          {t('caregiverDashboard.title')}
        </h1>
        <p className="mt-1 text-sm text-ink/60">
          {t('caregiverDashboard.welcome')}, {user.email ?? user.phone}
        </p>

        <div className="mt-6 rounded border border-dashed border-border bg-paper p-4">
          <p className="text-sm text-ink/60">{t('caregiverDashboard.placeholder')}</p>
        </div>

        <div className="mt-6 flex items-center justify-center">
          {/* Deliberately no "edit my details" link back to /caregiver/signup.
              That route is a registration form, and a signed-in caregiver
              landing on it and resubmitting would try to create a second
              account. Editing arrives with the real page. */}
          <Button
            variant="secondary"
            onClick={() => {
              logout();
              window.location.assign('/caregiver/join');
            }}
          >
            {t('caregiverDashboard.signOut')}
          </Button>
        </div>
      </div>
    </div>
  );
}