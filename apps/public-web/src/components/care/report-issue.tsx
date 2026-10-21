'use client';

import { useState } from 'react';
import { CAREGIVER_ISSUE_CATEGORIES, CLIENT_ISSUE_CATEGORIES, MAX_ISSUE_MESSAGE, type IssueReportCategory, type MyIssueReport, type PortalShift } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { ApiError } from '@/lib/api/client';
import { fmtDay, fmtTime } from '@/lib/colombo-time';
import { Button } from '@/components/ui/button';
import { Label, Select, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * "Something's not right" - the client's or caregiver's way to flag a problem
 * on a booking or shift. They never change the record: the report goes to our
 * team, who check it, put it right (or explain why it is right), and tell them.
 *
 * The client may point at one of the booking's shifts; the caregiver's report
 * is always about the shift it was opened from. `submit` sends it.
 */
export function ReportIssueForm({
  role,
  shifts,
  onSubmit,
  pending,
  error,
  onCancel,
}: {
  role: 'CLIENT' | 'CAREGIVER';
  /** Client only: the booking's shifts to choose from. */
  shifts?: PortalShift[];
  onSubmit: (body: { category: IssueReportCategory; message: string; shiftId?: string }) => void;
  pending: boolean;
  error: unknown;
  onCancel: () => void;
}) {
  const { t, locale } = useTranslation();
  const categories = role === 'CLIENT' ? CLIENT_ISSUE_CATEGORIES : CAREGIVER_ISSUE_CATEGORIES;
  const [category, setCategory] = useState<IssueReportCategory | ''>('');
  const [shiftId, setShiftId] = useState('');
  const [message, setMessage] = useState('');
  const valid = Boolean(category) && message.trim().length >= 5;
  const idp = `issue-${role.toLowerCase()}`;

  return (
    <form
      className="mt-3 space-y-3 rounded-lg border border-border bg-paper p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit({ category: category as IssueReportCategory, message: message.trim(), ...(shiftId ? { shiftId } : {}) });
      }}
    >
      <p className="text-sm text-ink/70">{t('issues.formIntro')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${idp}-category`} required>
            {t('issues.whatsWrong')}
          </Label>
          <Select id={`${idp}-category`} value={category} onChange={(e) => setCategory(e.target.value as IssueReportCategory | '')} required>
            <option value="">{t('issues.choose')}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {t(`issues.category.${c}`)}
              </option>
            ))}
          </Select>
        </div>
        {role === 'CLIENT' && shifts && shifts.length > 0 && (
          <div>
            <Label htmlFor={`${idp}-shift`}>{t('issues.whichShift')}</Label>
            <Select id={`${idp}-shift`} value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
              <option value="">{t('issues.wholeBooking')}</option>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {fmtDay(s.startsAt, locale)} · {fmtTime(s.startsAt, locale)}–{fmtTime(s.endsAt, locale)}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
      <div>
        <Label htmlFor={`${idp}-message`} required>
          {t('issues.tellUs')}
        </Label>
        <Textarea id={`${idp}-message`} rows={3} maxLength={MAX_ISSUE_MESSAGE} placeholder={t(role === 'CLIENT' ? 'issues.placeholderClient' : 'issues.placeholderCaregiver')} value={message} onChange={(e) => setMessage(e.target.value)} required />
      </div>
      {Boolean(error) && (
        <p role="alert" className="text-sm text-danger">
          {error instanceof ApiError && error.message ? error.message : t('care.actionError')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={!valid || pending}>
          {pending ? t('common.loading') : t('issues.send')}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel}>
          {t('issues.cancel')}
        </Button>
      </div>
    </form>
  );
}

const TONE: Record<MyIssueReport['status'], string> = {
  OPEN: 'bg-amber-100 text-amber-800',
  RESOLVED: 'bg-brand-light text-brand-dark',
  DISMISSED: 'bg-paper text-ink/60',
};

/** The person's own reports with where each stands and our team's answer. */
export function IssueReportList({ reports, showBooking = false }: { reports: MyIssueReport[]; showBooking?: boolean }) {
  const { t, locale } = useTranslation();
  if (!reports.length) return null;
  return (
    <ul className="space-y-2">
      {reports.map((r) => (
        <li key={r.id} className="rounded-md border border-border bg-white px-3 py-2 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span className="font-medium text-ink">
              {t(`issues.category.${r.category}`)}
              <span className="ml-1 text-xs font-normal text-ink/50">
                {showBooking ? `${r.bookingReference} · ` : ''}
                {r.shiftStartsAt ? fmtDay(r.shiftStartsAt, locale) : t('issues.wholeBooking')}
              </span>
            </span>
            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', TONE[r.status])}>{t(`issues.status.${r.status}`)}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-ink/70">{r.message}</p>
          {r.resolutionNote && <p className="mt-1 text-ink">{t('issues.ourAnswer', { note: r.resolutionNote })}</p>}
        </li>
      ))}
    </ul>
  );
}
