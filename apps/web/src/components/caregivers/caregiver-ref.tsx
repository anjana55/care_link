'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink, EyeOff } from 'lucide-react';
import { PUBLIC_CAREGIVER_STATUSES, caregiverRef } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import type { CaregiverStatus } from '@/lib/api/types';

/** Same rule as the verify-email redirect: empty means the public site shares this origin. */
const PUBLIC_SITE = (process.env.NEXT_PUBLIC_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '');

export function isPubliclyListed(status: CaregiverStatus): boolean {
  return (PUBLIC_CAREGIVER_STATUSES as readonly string[]).includes(status);
}

/**
 * The caregiver ID customers see on the public site ("Caregiver abcd1234").
 * Shown beside the registration number so staff can match what a caller
 * reads out; every staff caregiver search accepts it.
 *
 * `detailed` adds a copy button, a link to the public profile, and a note
 * when the caregiver is not currently listed (customers who saw them earlier
 * can no longer open the profile).
 */
export function CaregiverRef({
  publicId,
  status,
  detailed = false,
  showLabel = true,
  className = '',
}: {
  publicId: string | null | undefined;
  status?: CaregiverStatus;
  detailed?: boolean;
  /** Off where the surrounding row already says "Caregiver ID". */
  showLabel?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  if (!publicId) return null;
  const ref = caregiverRef(publicId);
  const listed = status ? isPubliclyListed(status) : true;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ref);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions); the ID is on screen anyway.
    }
  };

  if (!detailed) {
    return (
      <span className={`font-mono text-xs text-ink/50 ${className}`} title={t('caregivers.publicRef.hint')}>
        {t('caregivers.publicRef.short', { id: ref })}
      </span>
    );
  }

  return (
    <span className={`inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink/60 ${className}`}>
      <span title={t('caregivers.publicRef.hint')}>
        {showLabel && `${t('caregivers.publicRef.label')}: `}<span className="font-mono font-medium text-ink">{ref}</span>
      </span>
      <button
        type="button"
        onClick={copy}
        className="rounded p-1 text-ink/50 hover:bg-paper hover:text-ink print:hidden"
        aria-label={t('caregivers.publicRef.copy')}
        title={t('caregivers.publicRef.copy')}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {listed ? (
        <a
          href={`${PUBLIC_SITE}/caregivers/${publicId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-brand-dark hover:underline print:hidden"
        >
          {t('caregivers.publicRef.viewPublic')} <ExternalLink size={12} />
        </a>
      ) : (
        <span className="inline-flex items-center gap-1 text-amber-700">
          <EyeOff size={12} /> {t('caregivers.publicRef.notListed')}
        </span>
      )}
    </span>
  );
}
