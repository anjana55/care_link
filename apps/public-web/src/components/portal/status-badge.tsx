import { useTranslation } from '@/lib/i18n';
import type { CaregiverStatus, VerificationStatus } from '@/lib/api/portal-types';

const TONE: Record<string, string> = {
  good: 'bg-brand-light text-brand-dark',
  wait: 'bg-amber-100 text-amber-800',
  bad: 'bg-red-100 text-red-800',
  idle: 'bg-paper text-ink/60',
};

const REGISTRATION_TONE: Record<CaregiverStatus, string> = {
  DRAFT: 'idle',
  REGISTERED: 'wait',
  DOCUMENTS_PENDING: 'wait',
  UNDER_VERIFICATION: 'wait',
  VERIFIED: 'good',
  ACTIVE: 'good',
  INACTIVE: 'idle',
  SUSPENDED: 'bad',
  REJECTED: 'bad',
};

const VERIFICATION_TONE: Record<VerificationStatus, string> = {
  PENDING: 'wait',
  IN_PROGRESS: 'wait',
  VERIFIED: 'good',
  REJECTED: 'bad',
};

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[tone]}`}>{children}</span>;
}

/** Where the caregiver's whole registration stands. */
export function RegistrationStatusBadge({ status }: { status: CaregiverStatus }) {
  const { t } = useTranslation();
  return <Pill tone={REGISTRATION_TONE[status]}>{t(`portal.status.${status}`)}</Pill>;
}

/** Where one document, qualification or experience entry stands with staff. */
export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const { t } = useTranslation();
  return <Pill tone={VERIFICATION_TONE[status]}>{t(`portal.verification.${status}`)}</Pill>;
}

/** Entries staff have not accepted or started on: the only ones a caregiver may withdraw. */
export const isWithdrawable = (status: VerificationStatus) => status === 'PENDING' || status === 'REJECTED';
