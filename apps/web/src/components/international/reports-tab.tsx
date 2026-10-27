'use client';

import { useMemo, useState } from 'react';
import type { MoneyByCurrency, OverseasReport } from '@care-platform/shared';
import { placementStatusValues, welfareSeverityValues } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useOverseasReport } from '@/lib/hooks/use-international';
import { Select } from '@/components/ui/input';
import { countryName, day, money } from './shared';

const RANGES = ['3m', '12m', 'ytd', 'all'] as const;
type Range = (typeof RANGES)[number];

/** Today in Colombo, and the start of each range. */
function rangeFor(r: Range): { from?: string; to?: string } {
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const back = (months: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - months);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  if (r === '3m') return { from: back(3), to: today };
  if (r === 'ytd') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  if (r === 'all') return { from: back(60), to: today };
  return {};
}

const moneyList = (list: MoneyByCurrency[], locale: string) => (list.length ? list.map((m) => money(m.amount, m.currency, locale)).join(' · ') : '-');

/**
 * The international business at a glance, for a chosen range: how enquiries
 * turn into placements, how long it takes, what the placement fees bring in,
 * where employers want caregivers against who is ready to go, and how
 * placements end. Counted by the Colombo calendar.
 */
export function ReportsTab() {
  const { t, locale } = useTranslation();
  const [range, setRange] = useState<Range>('12m');
  const params = useMemo(() => rangeFor(range), [range]);
  const { data, isLoading, isError } = useOverseasReport(params);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink/60">
          {data ? t('international.reports.range', { from: day(data.range.from, locale), to: day(data.range.to, locale) }) : t('international.reports.hint')}
        </p>
        <Select className="sm:w-48" value={range} onChange={(e) => setRange(e.target.value as Range)} aria-label={t('international.reports.rangeLabel')}>
          {RANGES.map((r) => (
            <option key={r} value={r}>
              {t(`international.reports.ranges.${r}`)}
            </option>
          ))}
        </Select>
      </div>
      {isLoading && <p className="py-8 text-center text-sm text-ink/50">{t('common.loading')}</p>}
      {isError && <p className="text-sm text-danger">{t('common.actionFailed')}</p>}
      {data && <Report data={data} />}
    </div>
  );
}

function Report({ data }: { data: OverseasReport }) {
  const { t, locale } = useTranslation();
  const f = data.funnel;
  const steps: [string, number][] = [
    ['enquiries', f.enquiries],
    ['candidatesProposed', f.candidatesProposed],
    ['interviewsHeld', f.interviewsHeld],
    ['offersSent', f.offersSent],
    ['offersAccepted', f.offersAccepted],
    ['placements', f.placements],
  ];
  const max = Math.max(1, ...steps.map(([, n]) => n));
  const o = data.outcomes;
  const checkinRate = o.checkinsDue ? Math.round((o.checkinsDone / o.checkinsDue) * 100) : null;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={t('international.reports.tiles.placements')} value={String(f.placements)} />
        <Tile
          label={t('international.reports.tiles.timeToPlace')}
          value={data.timeToPlace.medianDays === null ? '-' : t('international.reports.days', { n: data.timeToPlace.medianDays })}
          note={data.timeToPlace.medianCandidateDays === null ? undefined : t('international.reports.fromProposed', { n: data.timeToPlace.medianCandidateDays })}
        />
        <Tile label={t('international.reports.tiles.collected')} value={moneyList(data.revenue.collected, locale)} />
        <Tile
          label={t('international.reports.tiles.outstanding')}
          value={moneyList(data.revenue.outstanding, locale)}
          note={data.revenue.overdueInvoices ? t('international.reports.overdue', { n: data.revenue.overdueInvoices }) : undefined}
        />
      </div>

      <Panel title={t('international.reports.funnel')} note={t('international.reports.funnelNote')}>
        <ol className="space-y-2">
          {steps.map(([key, n], i) => {
            const prev = i > 0 ? steps[i - 1][1] : null;
            const conversion = prev ? Math.round((n / prev) * 100) : null;
            return (
              <li key={key} className="grid grid-cols-[10rem_minmax(0,1fr)_5rem] items-center gap-3 text-sm">
                <span className="text-ink/70">{t(`international.reports.steps.${key}`)}</span>
                <span className="h-5 rounded-r bg-paper" title={`${t(`international.reports.steps.${key}`)}: ${n}`}>
                  <span className="block h-5 rounded-r-[4px] bg-brand" style={{ width: `${(n / max) * 100}%`, minWidth: n ? 4 : 0 }} />
                </span>
                <span className="text-right tabular-nums text-ink">
                  {n}
                  {conversion !== null && <span className="ml-1 text-xs text-ink/50">{conversion}%</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={t('international.reports.enquiriesByMonth')}>
          <MonthBars rows={data.monthly.map((m) => ({ month: m.month, n: m.enquiries }))} label={t('international.reports.steps.enquiries')} />
        </Panel>
        <Panel title={t('international.reports.placementsByMonth')}>
          <MonthBars rows={data.monthly.map((m) => ({ month: m.month, n: m.placements }))} label={t('international.reports.steps.placements')} />
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={t('international.reports.revenue')}>
          <dl className="space-y-1 text-sm">
            <Row label={t('international.reports.invoiced')} value={moneyList(data.revenue.invoiced, locale)} />
            <Row label={t('international.reports.collected')} value={moneyList(data.revenue.collected, locale)} />
            <Row label={t('international.reports.outstandingNow')} value={moneyList(data.revenue.outstanding, locale)} />
          </dl>
          {data.revenue.collectedByCountry.length > 0 && (
            <table className="mt-4 w-full text-sm">
              <caption className="mb-1 text-left text-xs font-semibold uppercase tracking-wide text-ink/50">{t('international.reports.byCountry')}</caption>
              <tbody>
                {data.revenue.collectedByCountry.map((r) => (
                  <tr key={`${r.country}-${r.currency}`} className="border-b border-border">
                    <td className="py-1 text-ink/70">{countryName(r.country, locale)}</td>
                    <td className="py-1 text-right tabular-nums text-ink">{money(r.amount, r.currency, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title={t('international.reports.outcomes')}>
          <dl className="space-y-1 text-sm">
            {placementStatusValues.map((s) => (
              <Row key={s} label={t(`international.placements.status.${s}`)} value={String(o.byStatus[s])} />
            ))}
            <Row label={t('international.reports.inGuarantee')} value={String(o.endedEarlyInGuarantee)} />
            <Row label={t('international.reports.checkins')} value={checkinRate === null ? '-' : t('international.reports.checkinsValue', { done: o.checkinsDone, due: o.checkinsDue, pct: checkinRate })} />
          </dl>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink/50">{t('international.reports.welfare')}</p>
          <dl className="mt-1 space-y-1 text-sm">
            {welfareSeverityValues.map((s) => (
              <Row key={s} label={t(`international.welfare.severity.${s}`)} value={String(o.welfareBySeverity[s])} />
            ))}
          </dl>
        </Panel>
      </div>

      <Panel title={t('international.reports.demand')} note={t('international.reports.demandNote')}>
        {data.demand.length === 0 ? (
          <p className="text-sm text-ink/50">{t('international.reports.noData')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-ink/50">
                <tr>
                  <th className="py-2 pr-3 font-medium">{t('international.reports.country')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t('international.reports.steps.enquiries')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t('international.reports.vacancies')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t('international.reports.roles')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t('international.reports.steps.placements')}</th>
                  <th className="py-2 text-right font-medium">{t('international.reports.pool')}</th>
                </tr>
              </thead>
              <tbody>
                {data.demand.map((d) => (
                  <tr key={d.country} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-3 text-ink">{countryName(d.country, locale)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{d.enquiries}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{d.vacancies}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{d.roles}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{d.placements}</td>
                    <td className={`py-1.5 text-right tabular-nums ${d.roles > d.talentPool ? 'font-semibold text-danger' : ''}`}>{d.talentPool}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.careSettings.length > 0 && (
          <p className="mt-3 text-xs text-ink/60">
            {t('international.reports.settings')}{' '}
            {data.careSettings.map((c) => `${t(`careTypes.${c.careSetting}`)} (${c.enquiries + c.vacancies})`).join(' · ')}
          </p>
        )}
      </Panel>

      <Panel title={t('international.reports.training')}>
        <div className="grid gap-3 sm:grid-cols-4">
          <Tile label={t('international.reports.interested')} value={String(data.training.interested)} />
          <Tile label={t('international.reports.completions')} value={String(data.training.completions)} />
          <Tile label={t('international.reports.certificates')} value={String(data.training.certificatesIssued)} />
          <Tile label={t('international.reports.results')} value={String(data.training.assessmentsVerified)} />
        </div>
      </Panel>
    </>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <p className="text-xs font-medium text-ink/60">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-ink">{value}</p>
      {note && <p className="mt-0.5 text-xs text-ink/50">{note}</p>}
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-white p-5">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {note && <p className="mt-0.5 text-xs text-ink/50">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-1 last:border-0">
      <dt className="text-ink/70">{label}</dt>
      <dd className="text-right tabular-nums text-ink">{value}</dd>
    </div>
  );
}

/** One series per month: thin bars on a shared baseline, the count on hover and in the accessible table. */
function MonthBars({ rows, label }: { rows: { month: string; n: number }[]; label: string }) {
  const { locale } = useTranslation();
  const max = Math.max(1, ...rows.map((r) => r.n));
  const fmt = (m: string) => new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : `${locale}-LK`, { month: 'short', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));
  return (
    <figure>
      <div className="flex h-32 items-end gap-[2px] border-b border-ink/20" aria-hidden>
        {rows.map((r) => (
          <div key={r.month} className="group relative flex h-full flex-1 items-end" title={`${fmt(r.month)} ${r.month.slice(0, 4)}: ${r.n}`}>
            <div className="w-full rounded-t-[4px] bg-brand transition-opacity group-hover:opacity-80" style={{ height: `${(r.n / max) * 100}%`, minHeight: r.n ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px] text-[10px] text-ink/50" aria-hidden>
        {rows.map((r, i) => (
          <span key={r.month} className="flex-1 text-center">
            {rows.length <= 13 || i % 3 === 0 ? fmt(r.month) : ''}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month}>
              <th scope="row">{r.month}</th>
              <td>{r.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
