'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  ClipboardX,
  Clock3,
  FileWarning,
  HandCoins,
  Inbox,
  Loader2,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  UserX,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { formatLkr, type BusinessInsights, type InsightKpi, type InsightRange, type InsightRatio } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useBusinessInsights } from '@/lib/hooks/use-insights';
import { cn } from '@/lib/utils';
import { ColumnChart, Funnel, Gauge, HBarList, Legend, LineChart, PairedBars, Sparkline, SplitBar, type HealthLevel } from './charts';

// --- formatting ---------------------------------------------------------------------

const INTL_LOCALE = { en: 'en-GB', si: 'si-LK', ta: 'ta-LK' } as const;

/** LKR 2.26M / LKR 845K / LKR 900 - for tiles and axes; exact amounts live in tooltips and lists. */
export function compactLkr(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1_000_000) return `${sign}LKR ${(a / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2)}M`;
  if (a >= 10_000) return `${sign}LKR ${Math.round(a / 1000)}K`;
  if (a >= 1_000) return `${sign}LKR ${(a / 1000).toFixed(1)}K`;
  return `${sign}LKR ${Math.round(a)}`;
}
const axisLkr = (n: number) => compactLkr(n).replace('LKR ', '');
const int = (n: number) => Math.round(n).toLocaleString('en-US');

function date(d: string, locale: keyof typeof INTL_LOCALE, opts: Intl.DateTimeFormatOptions) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString(INTL_LOCALE[locale], { timeZone: 'UTC', ...opts });
}

/** Running total - daily counts and monthly invoicing are spiky; a running total shows the trend and the gap. */
const cumulative = (values: number[]) => values.reduce<number[]>((acc, v) => [...acc, (acc[acc.length - 1] ?? 0) + v], []);

/** Percentage change, or null when there is nothing to compare with. */
function change(k: InsightKpi): number | null {
  if (k.previous === null || k.previous === 0) return null;
  return (k.value - k.previous) / Math.abs(k.previous);
}

// --- health thresholds ------------------------------------------------------------------

/**
 * Where each dial turns from "act" to "watch" to "good". Starting points for
 * a home-care agency - tune them here as the business learns its own normal.
 */
const DIALS = {
  conversion: { good: 0.35, watch: 0.2 },
  collection: { good: 0.9, watch: 0.7 },
  utilization: { good: 0.7, watch: 0.45 },
  attendance: { good: 0.97, watch: 0.93 },
  margin: { good: 0.2, watch: 0.1 },
} as const;

function levelOf(r: InsightRatio, t: { good: number; watch: number }): HealthLevel | null {
  if (r.value === null) return null;
  return r.value >= t.good ? 'good' : r.value >= t.watch ? 'watch' : 'act';
}

// --- building blocks ------------------------------------------------------------------------

function Panel({ title, subtitle, action, children, className }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-xl border border-border bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]', className)}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-ink/55">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Delta({ kpi, vsLabel }: { kpi: InsightKpi; vsLabel: string }) {
  const c = change(kpi);
  if (c === null) return <span className="text-xs text-ink/45">{vsLabel}: —</span>;
  const up = c >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  // Past tripling, a multiplier reads better than a four-digit percentage.
  const text = c >= 2 && kpi.previous ? `×${Math.round(kpi.value / kpi.previous)}` : `${Math.round(Math.abs(c) * 100)}%`;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-xs">
      <span
        className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold', up ? 'bg-[#e6f4e6]' : 'bg-danger-light')}
        style={{ color: up ? 'var(--viz-good-text)' : '#a12a2a' }}
      >
        <Icon className="h-3 w-3" aria-hidden />
        {text}
      </span>
      <span className="text-ink/45">{vsLabel}</span>
    </span>
  );
}

function KpiTile({
  label,
  value,
  kpi,
  spark,
  vsLabel,
  hint,
}: {
  label: string;
  value: string;
  kpi?: InsightKpi;
  spark?: number[];
  vsLabel: string;
  hint?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col justify-between rounded-xl border border-border bg-white p-3 sm:p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]" title={hint}>
      <div>
        <div className="text-[11px] font-medium uppercase tracking-wide text-ink/55 sm:text-xs">{label}</div>
        <div className="mt-1.5 text-xl font-bold tracking-tight text-ink sm:text-2xl">{value}</div>
        <div className="mt-1 min-h-[20px]">{kpi ? <Delta kpi={kpi} vsLabel={vsLabel} /> : hint ? <span className="text-xs text-ink/50">{hint}</span> : null}</div>
      </div>
      {spark && spark.length > 1 && (
        <div className="mt-3">
          <Sparkline values={spark} />
        </div>
      )}
    </div>
  );
}

const SEVERITY_STYLE = {
  act: { Icon: AlertOctagon, color: 'var(--viz-critical)', ring: 'bg-[#fbe7e7]' },
  watch: { Icon: AlertTriangle, color: '#b07800', ring: 'bg-[#fdf3dc]' },
} as const;

interface AttentionItem {
  key: string;
  count: number;
  label: string;
  detail?: string;
  href: string;
  severity: 'act' | 'watch';
  Icon: LucideIcon;
}

// --- the dashboard ------------------------------------------------------------------------------

/**
 * The staff dashboard for ADMIN and STAFF: the business's vital signs on one
 * screen. Top to bottom it answers "how are we doing" (headline numbers and
 * dials), "what needs doing today" (attention list), then the detail behind
 * each: money, demand, operations, and the caregiver side of the market.
 */
export function BusinessDashboard() {
  const { t, locale } = useTranslation();
  const [range, setRange] = useState<InsightRange>('30d');
  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useBusinessInsights(range, locale);

  const greeting = useMemo(() => {
    const h = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', hour12: false }));
    return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  }, []);

  return (
    <div className="viz mx-auto max-w-[1400px] space-y-5">
      {/* Header + range */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">{t(`dashboard.greeting.${greeting}`)}</h1>
          <p className="mt-1 text-sm text-ink/60">
            {data
              ? t('dashboard.periodLine', {
                  from: date(data.from, locale, { day: 'numeric', month: 'short', year: data.range === '12m' ? 'numeric' : undefined }),
                  to: date(data.to, locale, { day: 'numeric', month: 'short', year: 'numeric' }),
                })
              : t('dashboard.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {dataUpdatedAt > 0 && (
            <button
              type="button"
              onClick={() => refetch()}
              className="inline-flex items-center gap-1.5 text-xs text-ink/55 hover:text-ink"
              aria-label={t('dashboard.refresh')}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} aria-hidden />
              <span className="hidden sm:inline">{t('dashboard.updatedAt', {
                time: new Date(dataUpdatedAt).toLocaleTimeString(INTL_LOCALE[locale], { hour: '2-digit', minute: '2-digit' }),
              })}</span>
            </button>
          )}
          <div className="inline-flex rounded-lg border border-border bg-white p-1" role="radiogroup" aria-label={t('dashboard.range.label')}>
            {(['30d', '90d', '12m'] as const).map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={range === r}
                onClick={() => setRange(r)}
                className={cn(
                  'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  range === r ? 'bg-brand text-white shadow-sm' : 'text-ink/65 hover:bg-brand-light',
                )}
              >
                {t(`dashboard.range.${r}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading && !data && (
        <div className="flex items-center justify-center gap-2 py-24 text-sm text-ink/55" role="status">
          <Loader2 className="h-5 w-5 animate-spin text-brand" aria-hidden />
          {t('common.loading')}
        </div>
      )}
      {isError && !data && (
        <div role="alert" className="rounded-xl border border-danger/30 bg-danger-light p-5 text-sm text-danger">
          {t('dashboard.loadFailed')}{' '}
          <button type="button" className="font-semibold underline" onClick={() => refetch()}>
            {t('dashboard.retry')}
          </button>
        </div>
      )}

      {data && <DashboardBody data={data} />}
    </div>
  );
}

function DashboardBody({ data }: { data: BusinessInsights }) {
  const { t, locale } = useTranslation();
  const vs = t(`dashboard.vs.${data.range}`);
  const k = data.kpis;

  const bucketLabels = data.buckets.map((b) =>
    data.bucketUnit === 'month' ? date(b.start, locale, { month: 'short' }) : date(b.start, locale, { day: 'numeric', month: 'short' }),
  );
  const bucketTitles = data.buckets.map((b) =>
    data.bucketUnit === 'month'
      ? date(b.start, locale, { month: 'long', year: 'numeric' })
      : data.bucketUnit === 'week'
        ? `${date(b.start, locale, { day: 'numeric', month: 'short' })} – ${date(b.end, locale, { day: 'numeric', month: 'short' })}`
        : date(b.start, locale, { weekday: 'short', day: 'numeric', month: 'short' }),
  );

  // Days and weeks plot running totals (see `cumulative`): with monthly
  // invoicing, per-day or per-week revenue is all spikes. Months plot each bucket.
  const running = data.bucketUnit !== 'month';
  const trend = (values: number[]) => (running ? cumulative(values) : values);
  const trendTitles = running
    ? data.buckets.map((b) => t('dashboard.upTo', { date: date(b.end > data.to ? data.to : b.end, locale, { day: 'numeric', month: 'short' }) }))
    : bucketTitles;
  const S1 = 'var(--viz-series-1)';
  const S2 = 'var(--viz-series-2)';

  // --- attention ---
  const a = data.attention;
  const attention: AttentionItem[] = [
    { key: 'overdue', count: a.overdueInvoices, label: t('dashboard.attention.overdueInvoices'), detail: formatLkr(a.overdueAmount), href: '/invoices?tab=overdue', severity: 'act', Icon: ReceiptText },
    { key: 'stale', count: a.newRequestsOver24h, label: t('dashboard.attention.newRequestsOver24h'), href: '/requests?tab=open', severity: 'act', Icon: Inbox },
    { key: 'careNotDone', count: a.careCriticalNotDone, label: t('dashboard.attention.careCriticalNotDone'), href: '/bookings?tab=care', severity: 'act', Icon: ClipboardX },
    { key: 'missed', count: a.missedShiftsLast7d, label: t('dashboard.attention.missedShifts'), href: '/bookings', severity: 'act', Icon: UserX },
    { key: 'unbilled', count: a.unbilledCompletedShifts, label: t('dashboard.attention.unbilledShifts'), href: '/invoices/new', severity: 'act', Icon: FileWarning },
    { key: 'unconfirmed', count: a.unconfirmedShiftsNext7d, label: t('dashboard.attention.unconfirmedShifts'), href: '/bookings?tab=DRAFT', severity: 'act', Icon: CalendarClock },
    { key: 'unassigned', count: a.unassignedOpenRequests, label: t('dashboard.attention.unassignedRequests'), href: '/requests?tab=open', severity: 'watch', Icon: Inbox },
    { key: 'payouts', count: a.payoutsAwaitingPayment, label: t('dashboard.attention.payoutsAwaiting'), detail: formatLkr(a.payoutsAwaitingAmount), href: '/payouts?tab=APPROVED', severity: 'watch', Icon: Wallet },
    { key: 'careUnconfirmed', count: a.careCriticalUnconfirmed, label: t('dashboard.attention.careCriticalUnconfirmed'), href: '/bookings?tab=care', severity: 'watch', Icon: ClipboardList },
    { key: 'drafts', count: a.draftBookings, label: t('dashboard.attention.draftBookings'), href: '/bookings?tab=DRAFT', severity: 'watch', Icon: CalendarClock },
    { key: 'verify', count: a.caregiversAwaitingVerification, label: t('dashboard.attention.caregiversAwaiting'), href: '/caregivers?status=UNDER_VERIFICATION', severity: 'watch', Icon: ShieldCheck },
    { key: 'docs', count: a.documentsPending, label: t('dashboard.attention.documentsPending'), href: '/caregivers?status=DOCUMENTS_PENDING', severity: 'watch', Icon: FileWarning },
    { key: 'clients', count: a.clientsPendingReview, label: t('dashboard.attention.clientsPending'), href: '/clients?status=PENDING_REVIEW', severity: 'watch', Icon: UserPlus },
  ].filter((i) => i.count > 0) as AttentionItem[];

  const d = data.dials;
  const dials: { key: keyof typeof DIALS; r: InsightRatio; detail: string }[] = [
    { key: 'conversion', r: d.conversion, detail: t('dashboard.dials.conversionDetail', { n: int(d.conversion.numerator), d: int(d.conversion.denominator) }) },
    { key: 'collection', r: d.collection, detail: t('dashboard.dials.collectionDetail', { n: compactLkr(d.collection.numerator), d: compactLkr(d.collection.denominator) }) },
    { key: 'utilization', r: d.utilization, detail: t('dashboard.dials.utilizationDetail', { n: int(d.utilization.numerator), d: int(d.utilization.denominator) }) },
    { key: 'attendance', r: d.attendance, detail: t('dashboard.dials.attendanceDetail', { n: int(d.attendance.numerator), d: int(d.attendance.denominator) }) },
    { key: 'margin', r: d.margin, detail: t('dashboard.dials.marginDetail', { n: compactLkr(d.margin.numerator), d: compactLkr(d.margin.denominator) }) },
  ];

  const req = data.requests;
  const agingTotal = data.receivablesAging.reduce((s, b) => s + b.amount, 0);
  const pipelineOrder = ['DRAFT', 'REGISTERED', 'DOCUMENTS_PENDING', 'UNDER_VERIFICATION', 'VERIFIED', 'ACTIVE'];
  const upcoming = data.upcomingShifts;

  return (
    <>
      {/* 1. Headline numbers */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiTile label={t('dashboard.kpi.invoiced')} value={compactLkr(k.invoiced.value)} kpi={k.invoiced} spark={data.series.invoiced} vsLabel={vs} hint={formatLkr(k.invoiced.value)} />
        <KpiTile label={t('dashboard.kpi.collected')} value={compactLkr(k.collected.value)} kpi={k.collected} spark={data.series.collected} vsLabel={vs} hint={formatLkr(k.collected.value)} />
        <KpiTile label={t('dashboard.kpi.grossMargin')} value={compactLkr(k.grossMargin.value)} kpi={k.grossMargin} vsLabel={vs} hint={t('dashboard.kpi.grossMarginHint')} />
        <KpiTile label={t('dashboard.kpi.careHours')} value={int(k.careHours.value)} kpi={k.careHours} spark={data.series.careHours} vsLabel={vs} />
        <KpiTile label={t('dashboard.kpi.newRequests')} value={int(k.newRequests.value)} kpi={k.newRequests} spark={data.series.requests} vsLabel={vs} />
        <KpiTile label={t('dashboard.kpi.placements')} value={int(k.placements.value)} kpi={k.placements} spark={data.series.placements} vsLabel={vs} />
        <KpiTile
          label={t('dashboard.kpi.clients')}
          value={int(k.activeClients)}
          vsLabel={vs}
          hint={t('dashboard.kpi.clientsHint', { n: int(k.newClients.value) })}
        />
        <KpiTile
          label={t('dashboard.kpi.caregivers')}
          value={int(k.activeCaregivers)}
          vsLabel={vs}
          hint={t('dashboard.kpi.caregiversHint', { n: int(k.newCaregivers.value) })}
        />
      </div>

      {/* 2. Vital signs */}
      <Panel title={t('dashboard.dials.title')} subtitle={t('dashboard.dials.subtitle')}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
          {dials.map(({ key, r, detail }) => {
            const level = levelOf(r, DIALS[key]);
            return (
              <Gauge
                key={key}
                value={r.value}
                target={DIALS[key].good}
                level={level}
                levelLabel={level ? t(`dashboard.health.${level}`) : ''}
                label={t(`dashboard.dials.${key}`)}
                detail={detail}
                emptyLabel={t('dashboard.noData')}
              />
            );
          })}
        </div>
      </Panel>

      {/* 3. Money + today's list */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title={t('dashboard.revenue.title')}
          subtitle={`${t('dashboard.revenue.subtitle')}${running ? ` · ${t('dashboard.runningTotal')}` : ''}`}
          action={
            <Legend
              items={[
                { label: t('dashboard.revenue.invoiced'), color: S1 },
                { label: t('dashboard.revenue.collected'), color: S2 },
              ]}
            />
          }
        >
          <LineChart
            labels={bucketLabels}
            tooltipTitles={trendTitles}
            series={[
              { key: 'invoiced', label: t('dashboard.revenue.invoiced'), values: trend(data.series.invoiced), color: S1 },
              { key: 'collected', label: t('dashboard.revenue.collected'), values: trend(data.series.collected), color: S2 },
            ]}
            format={(n) => formatLkr(n)}
            axisFormat={axisLkr}
            ariaLabel={t('dashboard.revenue.title')}
            height={340}
          />
        </Panel>

        {/* On a phone the to-do list comes before the chart. */}
        <Panel className="order-first xl:order-none" title={t('dashboard.attention.title')} subtitle={t('dashboard.attention.subtitle')}>
          {attention.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <CheckCircle2 className="h-8 w-8" style={{ color: 'var(--viz-good)' }} aria-hidden />
              <p className="text-sm font-medium text-ink">{t('dashboard.attention.allClear')}</p>
            </div>
          ) : (
            <ul className="-mx-2 divide-y divide-border xl:max-h-[380px] xl:overflow-y-auto">
              {attention.map((item) => {
                const sev = SEVERITY_STYLE[item.severity];
                return (
                  <li key={item.key}>
                    <Link href={item.href} className="group flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-paper">
                      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', sev.ring)}>
                        <item.Icon className="h-4 w-4" style={{ color: sev.color }} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-ink">{item.label}</span>
                        <span className="flex items-center gap-1 text-[11px] text-ink/50">
                          <sev.Icon className="h-3 w-3" style={{ color: sev.color }} aria-hidden />
                          {t(`dashboard.severity.${item.severity}`)}
                          {item.detail && <span className="text-ink/60">· {item.detail}</span>}
                        </span>
                      </span>
                      <span className="text-lg font-bold tabular-nums text-ink">{int(item.count)}</span>
                      <ArrowRight className="h-4 w-4 text-ink/30 transition-transform group-hover:translate-x-0.5 group-hover:text-ink/60" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      {/* 4. Demand */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel title={t('dashboard.funnel.title')} subtitle={t('dashboard.funnel.subtitle')}>
          <Funnel
            stages={[
              { key: 'created', label: t('dashboard.funnel.created'), value: req.funnel.created },
              { key: 'contacted', label: t('dashboard.funnel.contacted'), value: req.funnel.contacted },
              { key: 'introduced', label: t('dashboard.funnel.introduced'), value: req.funnel.introduced },
              { key: 'booked', label: t('dashboard.funnel.booked'), value: req.funnel.booked },
            ]}
            rateLabel={(pct) => t('dashboard.funnel.moved', { pct })}
            ariaLabel={t('dashboard.funnel.title')}
          />
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4">
            <div>
              <div className="flex items-center gap-1 text-xs text-ink/55">
                <Clock3 className="h-3.5 w-3.5" aria-hidden />
                {t('dashboard.funnel.firstResponse')}
              </div>
              <div className="mt-0.5 text-lg font-bold text-ink">
                {req.medianFirstResponseHours === null
                  ? '—'
                  : req.medianFirstResponseHours < 1
                    ? t('dashboard.minutes', { n: Math.round(req.medianFirstResponseHours * 60) })
                    : t('dashboard.hours', { n: req.medianFirstResponseHours.toFixed(1) })}
              </div>
            </div>
            <div>
              <div className="text-xs text-ink/55">{t('dashboard.funnel.openNow')}</div>
              <div className="mt-0.5 text-lg font-bold text-ink">{int(req.open.NEW + req.open.IN_PROGRESS + req.open.INTRODUCED)}</div>
              <div className="text-[11px] text-ink/50">
                {t('dashboard.funnel.openSplit', { n: req.open.NEW, p: req.open.IN_PROGRESS, i: req.open.INTRODUCED })}
              </div>
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-1.5 text-xs text-ink/55">{t('dashboard.funnel.sources')}</div>
            <SplitBar
              parts={[
                { key: 'WEB', label: t('dashboard.source.WEB'), value: req.sources.WEB, color: S1 },
                { key: 'PHONE', label: t('dashboard.source.PHONE'), value: req.sources.PHONE, color: S2 },
              ]}
            />
          </div>
        </Panel>

        <Panel
          className="xl:col-span-2"
          title={t('dashboard.demand.title')}
          subtitle={`${t('dashboard.demand.subtitle')}${running ? ` · ${t('dashboard.runningTotal')}` : ''}`}
          action={
            <Legend
              items={[
                { label: t('dashboard.demand.requests'), color: S1 },
                { label: t('dashboard.demand.placements'), color: S2 },
              ]}
            />
          }
        >
          <LineChart
            labels={bucketLabels}
            tooltipTitles={trendTitles}
            series={[
              { key: 'requests', label: t('dashboard.demand.requests'), values: trend(data.series.requests), color: S1 },
              { key: 'placements', label: t('dashboard.demand.placements'), values: trend(data.series.placements), color: S2 },
            ]}
            format={int}
            ariaLabel={t('dashboard.demand.title')}
            height={220}
          />
          <div className="mt-5 border-t border-border pt-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/55">{t('dashboard.closeReasons.title')}</h3>
            {req.closeReasons.length === 0 ? (
              <p className="text-sm text-ink/50">{t('dashboard.noData')}</p>
            ) : (
              <div className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
                {[0, 1].map((half) => {
                  const rows = req.closeReasons.map((r) => ({
                    key: r.key,
                    label: t(`requests.closeReason.${r.key}`),
                    value: r.count,
                    display: int(r.count),
                    // Placed is the good outcome - its own slot, never a status colour.
                    color: r.key === 'PLACED' ? 'var(--viz-series-3)' : undefined,
                  }));
                  const mid = Math.ceil(rows.length / 2);
                  const max = Math.max(...rows.map((r) => r.value));
                  const part = half === 0 ? rows.slice(0, mid) : rows.slice(mid);
                  // Both halves share one scale so the bars compare across columns.
                  return <HBarList key={half} ariaLabel={t('dashboard.closeReasons.title')} rows={part} scaleMax={max} />;
                })}
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* 5. Operations + money owed */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title={t('dashboard.upcoming.title')}
          subtitle={t('dashboard.upcoming.subtitle', { n: int(upcoming.reduce((s, x) => s + x.scheduled, 0)) })}
          action={
            <Legend
              items={[
                { label: t('dashboard.upcoming.scheduled'), color: S1 },
                { label: t('dashboard.upcoming.draft'), color: S2 },
              ]}
            />
          }
        >
          <ColumnChart
            labels={upcoming.map((u, i) => (i === 0 ? t('dashboard.today') : date(u.date, locale, { day: 'numeric' })))}
            tooltipTitles={upcoming.map((u) => date(u.date, locale, { weekday: 'long', day: 'numeric', month: 'short' }))}
            series={[
              { key: 'scheduled', label: t('dashboard.upcoming.scheduled'), values: upcoming.map((u) => u.scheduled), color: S1 },
              { key: 'draft', label: t('dashboard.upcoming.draft'), values: upcoming.map((u) => u.draft), color: S2 },
            ]}
            format={int}
            highlightFirst
            ariaLabel={t('dashboard.upcoming.title')}
          />
        </Panel>

        <Panel title={t('dashboard.aging.title')} subtitle={t('dashboard.aging.subtitle', { amount: formatLkr(agingTotal) })}>
          <HBarList
            ariaLabel={t('dashboard.aging.title')}
            rows={data.receivablesAging.map((b, i) => ({
              key: b.key,
              label: (
                <span>
                  {t(`dashboard.aging.${b.key}`)} <span className="text-ink/45">· {t('dashboard.aging.invoices', { n: b.count })}</span>
                </span>
              ),
              value: b.amount,
              display: compactLkr(b.amount),
              detail: formatLkr(b.amount),
              // An ordered scale: older debt reads darker.
              color: `var(--viz-ramp-${i + 1})`,
            }))}
          />
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-paper px-3 py-2 text-xs text-ink/65">
            <HandCoins className="h-4 w-4 shrink-0 text-ink/50" aria-hidden />
            {t('dashboard.aging.note')}
          </div>
        </Panel>
      </div>

      {/* 6. The caregiver side */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <Panel title={t('dashboard.supply.title')} subtitle={t('dashboard.supply.subtitle')}>
          <div className="-mt-2 mb-3">
            <Legend
              items={[
                { label: t('dashboard.supply.requests'), color: S1 },
                { label: t('dashboard.supply.caregivers'), color: S2 },
              ]}
            />
          </div>
          {data.demandSupply.length === 0 ? (
            <p className="text-sm text-ink/50">{t('dashboard.noData')}</p>
          ) : (
            <PairedBars
              rows={data.demandSupply.map((r) => ({ key: String(r.districtId), label: r.district, a: r.requests, b: r.activeCaregivers }))}
              a={{ label: t('dashboard.supply.requests'), color: S1 }}
              b={{ label: t('dashboard.supply.caregivers'), color: S2 }}
              ariaLabel={t('dashboard.supply.title')}
            />
          )}
        </Panel>

        <Panel title={t('dashboard.pipeline.title')} subtitle={t('dashboard.pipeline.subtitle')}>
          <HBarList
            ariaLabel={t('dashboard.pipeline.title')}
            rows={pipelineOrder.map((key, i) => {
              const count = data.caregiverPipeline.find((p) => p.key === key)?.count ?? 0;
              return { key, label: t(`caregivers.status.${key}`), value: count, display: int(count), color: `var(--viz-ramp-${Math.min(5, i + 1)})` };
            })}
          />
          <p className="mt-3 text-[11px] text-ink/50">
            {t('dashboard.pipeline.inactive', {
              n: int(data.caregiverPipeline.filter((p) => ['INACTIVE', 'SUSPENDED', 'REJECTED'].includes(p.key)).reduce((s, p) => s + p.count, 0)),
            })}
          </p>
        </Panel>

        <Panel title={t('dashboard.top.title')} subtitle={t('dashboard.top.subtitle')} className="lg:col-span-2 xl:col-span-1">
          {data.topCaregivers.length === 0 ? (
            <p className="text-sm text-ink/50">{t('dashboard.noData')}</p>
          ) : (
            <ol className="space-y-3">
              {data.topCaregivers.map((c, i) => {
                const max = data.topCaregivers[0].hours || 1;
                return (
                  <li key={c.id}>
                    <Link href={`/caregivers/${c.id}`} className="group block">
                      <div className="flex items-center gap-3">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-light text-xs font-bold text-brand-dark">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-sm text-ink group-hover:underline">{c.name}</span>
                        <span className="text-right text-xs text-ink/55">
                          <span className="text-sm font-semibold tabular-nums text-ink">{int(c.hours)}</span> {t('dashboard.top.hours')}
                          <span className="ml-1 text-ink/40">· {t('dashboard.top.shifts', { n: c.shifts })}</span>
                        </span>
                      </div>
                      <div className="ml-10 mt-1 h-1.5 overflow-hidden rounded-r bg-paper">
                        <div className="h-full rounded-r" style={{ width: `${(c.hours / max) * 100}%`, background: 'rgb(var(--color-accent, 47 122 132))' }} />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>
      </div>
    </>
  );
}
