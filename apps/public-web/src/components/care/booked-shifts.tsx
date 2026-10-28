'use client';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { useMyShiftIssues, useMyShifts, useReportShiftIssue } from '@/lib/hooks/use-caregiver-portal';
import { ShiftList } from './shift-list';
import { IssueReportList, ReportIssueForm } from './report-issue';
import { ShiftCarePlan } from './shift-care-plan';

/**
 * The caregiver's confirmed work, read-only: staff arrange bookings and any
 * change to them by phone. Shows where (by area) and which booking, never the
 * client's name or address - staff share those when they call.
 *
 * Each shift that has started (or was cancelled) has "Something's not right?"
 * - times, whether it happened, or the pay - which goes to our team as a
 * report; their reports and our answers are listed underneath.
 *
 * A shift on a booking with a care plan has "Care plan" from a day before it
 * starts until its day ends: what to do, when, and anything the family marked.
 */
export function BookedShifts() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useMyShifts();
  const { data: reports } = useMyShiftIssues();
  const report = useReportShiftIssue();
  const [reporting, setReporting] = useState<string | null>(null);
  const [planFor, setPlanFor] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const now = Date.now();

  return (
    <section className="rounded-lg border border-border bg-white p-5" aria-labelledby="booked-shifts">
      <h2 id="booked-shifts" className="text-base font-semibold text-ink">
        {t('portal.shifts.bookedTitle')}
      </h2>
      <p className="mt-1 text-sm text-ink/60">{t('portal.shifts.bookedSubtitle')}</p>
      <div className="mt-3">
        {isLoading && <p className="text-sm text-ink/50">{t('common.loading')}</p>}
        {isError && <p className="text-sm text-danger">{t('care.actionError')}</p>}
        {data && data.length === 0 && <p className="text-sm text-ink/50">{t('portal.shifts.noBooked')}</p>}
        {data && data.length > 0 && (
          <ShiftList
            shifts={data}
            coverLabel={t('portal.shifts.cover')}
            extra={(s) => (
              <>
                {s.bookingReference}
                {s.area && ` · ${s.area}`}
              </>
            )}
            action={(s) => (
              <>
                {s.hasCarePlan && (
                  <button
                    type="button"
                    aria-expanded={planFor === s.id}
                    className="text-xs font-medium text-brand hover:underline"
                    onClick={() => setPlanFor(planFor === s.id ? null : s.id)}
                  >
                    {planFor === s.id ? t('carePlan.hidePlan') : t('carePlan.showPlan')}
                  </button>
                )}
                {(new Date(s.startsAt).getTime() <= now || s.status === 'CANCELLED') && reporting !== s.id ? (
                  <button
                    type="button"
                    className="text-xs font-medium text-brand hover:underline"
                    onClick={() => {
                      setSent(false);
                      setReporting(s.id);
                    }}
                  >
                    {t('issues.reportShort')}
                  </button>
                ) : null}
              </>
            )}
            below={(s) =>
              planFor === s.id || reporting === s.id ? (
                <>
                  {planFor === s.id && <ShiftCarePlan shiftId={s.id} />}
                  {reporting === s.id && (
                    <ReportIssueForm
                      role="CAREGIVER"
                      pending={report.isPending}
                      error={report.error}
                      onCancel={() => setReporting(null)}
                      onSubmit={(body) =>
                        report.mutate(
                          { ...body, shiftId: s.id },
                          {
                            onSuccess: () => {
                              setReporting(null);
                              setSent(true);
                            },
                          },
                        )
                      }
                    />
                  )}
                </>
              ) : null
            }
          />
        )}
        {sent && (
          <p role="status" className="mt-2 text-sm text-brand-dark">
            {t('issues.sent')}
          </p>
        )}
        {reports && reports.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink/50">{t('issues.yourReports')}</p>
            <IssueReportList reports={reports} showBooking />
          </div>
        )}
      </div>
    </section>
  );
}
