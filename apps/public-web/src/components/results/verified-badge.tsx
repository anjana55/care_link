import { ShieldCheck } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';

/**
 * Marks a caregiver the platform has verified (status Verified or Active).
 * Search also lists registered caregivers still being checked, so this is
 * what tells the two apart at a glance.
 */
export function VerifiedBadge({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const { t } = useTranslation();
  return (
    <span
      title={t('results.verifiedHint')}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-accent px-2.5 py-0.5 font-semibold text-white ${size === 'md' ? 'text-sm' : 'text-xs'}`}
    >
      <ShieldCheck className={size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'} aria-hidden />
      {t('results.verified')}
      <span className="sr-only">: {t('results.verifiedHint')}</span>
    </span>
  );
}
