'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, AlertOctagon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Small, dependency-free SVG charts for the staff dashboard.
 *
 * Conventions (see globals.css `.viz`): 2px lines, bars at most 24px thick
 * with a 4px rounded data end and a square baseline, a 2px surface gap
 * between touching segments, hairline solid gridlines, and every mark has a
 * hover tooltip. Text is always ink, never the series colour.
 */

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Width of a container, kept current on resize, so charts draw at real pixels and text never stretches. */
function useWidth<T extends HTMLElement>(fallback = 600) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setWidth(Math.max(120, Math.floor(el.getBoundingClientRect().width)));
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** 0, then three or four round steps up to at least `max`. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/** A path for a vertical bar with a rounded top (data end) and a square base. */
function barPath(x: number, y: number, w: number, h: number, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/** Same, horizontal: square at the left baseline, rounded at the right data end. */
function hbarPath(x: number, y: number, w: number, h: number, r = 4) {
  if (w <= 0) return '';
  const rr = Math.min(r, h / 2, w);
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
}

// --- tooltip -------------------------------------------------------------------

export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
}

function Tooltip({ x, y, width, title, rows }: { x: number; y: number; width: number; title: string; rows: TooltipRow[] }) {
  // Flip to the left of the pointer near the right edge so it never leaves the card.
  const left = x > width - 190 ? Math.max(0, x - 180) : x + 12;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 min-w-[150px] rounded-md border border-border bg-white px-3 py-2 text-xs shadow-lg"
      style={{ left, top: Math.max(0, y - 10) }}
    >
      <div className="mb-1 font-semibold text-ink">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 text-ink/70">
          <span className="flex items-center gap-1.5">
            {r.color && <span className="inline-block h-2 w-2 rounded-full" style={{ background: r.color }} aria-hidden />}
            {r.label}
          </span>
          <span className="tabular-nums font-medium text-ink">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink/70">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

// --- sparkline -----------------------------------------------------------------

/** Trend-only line for a KPI tile: no axes, end dot marks "now". */
export function Sparkline({ values, color = 'rgb(var(--color-accent, 47 122 132))', height = 36 }: { values: number[]; color?: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>(160);
  const gid = useId().replace(/:/g, '');
  if (values.length < 2) return <div ref={ref} style={{ height }} />;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pad = 5;
  const pts = values.map((v, i) => [pad + (i * (width - pad * 2)) / (values.length - 1), pad + (1 - (v - min) / span) * (height - pad * 2)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const area = `${line}L${pts[pts.length - 1][0]},${height}L${pts[0][0]},${height}Z`;
  const [lx, ly] = pts[pts.length - 1];
  return (
    <div ref={ref} aria-hidden>
      <svg width={width} height={height} className="block overflow-visible">
        <defs>
          <linearGradient id={`spark-${gid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.16" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#spark-${gid})`} />
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={lx} cy={ly} r={4} fill={color} stroke="var(--viz-surface)" strokeWidth={2} />
      </svg>
    </div>
  );
}

// --- line / area chart -----------------------------------------------------------

export interface ChartSeries {
  key: string;
  label: string;
  values: number[];
  color: string;
}

/**
 * Time series on one shared axis, with a crosshair tooltip. One series gets a
 * soft area wash; several are lines only (a legend sits above, outside this).
 */
export function LineChart({
  labels,
  tooltipTitles,
  series,
  format,
  axisFormat = format,
  height = 240,
  ariaLabel,
}: {
  labels: string[];
  tooltipTitles?: string[];
  series: ChartSeries[];
  format: (n: number) => string;
  axisFormat?: (n: number) => string;
  height?: number;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const m = { l: 56, r: 12, t: 10, b: 26 };
  const w = width - m.l - m.r;
  const h = height - m.t - m.b;
  const x = (i: number) => m.l + (n <= 1 ? w / 2 : (i * w) / (n - 1));
  const y = (v: number) => m.t + h - (v / top) * h;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 70))));

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = n <= 1 ? 0 : Math.round((px / rect.width) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  }

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'} strokeWidth={1} />
            <text x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--viz-muted)" className="tabular-nums">
              {axisFormat(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) => {
          // Every k-th label, plus the last; drop one that would crowd the last.
          const show = i === n - 1 || (i % labelEvery === 0 && n - 1 - i >= labelEvery * 0.75);
          return show ? (
            <text key={i} x={x(i)} y={height - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize={11} fill="var(--viz-muted)">
              {l}
            </text>
          ) : null;
        })}
        {series.length === 1 && (
          <path
            d={`${series[0].values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('')}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`}
            fill={series[0].color}
            opacity={0.1}
          />
        )}
        {series.map((s) => (
          <path
            key={s.key}
            d={s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {/* End dots mark the latest value of each series. */}
        {hover === null &&
          series.map((s) => <circle key={s.key} cx={x(n - 1)} cy={y(s.values[n - 1] ?? 0)} r={4} fill={s.color} stroke="var(--viz-surface)" strokeWidth={2} />)}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + h} stroke="var(--viz-axis)" strokeWidth={1} />
            {series.map((s) => (
              <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4.5} fill={s.color} stroke="var(--viz-surface)" strokeWidth={2} />
            ))}
          </g>
        )}
        <rect x={m.l} y={m.t} width={w} height={h} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hover !== null && (
        <Tooltip
          x={x(hover)}
          y={m.t}
          width={width}
          title={tooltipTitles?.[hover] ?? labels[hover]}
          rows={series.map((s) => ({ label: s.label, value: format(s.values[hover] ?? 0), color: s.color }))}
        />
      )}
    </div>
  );
}

// --- columns (stacked) -----------------------------------------------------------

/** Vertical columns, stacked when given several series. Per-column tooltip. */
export function ColumnChart({
  labels,
  tooltipTitles,
  series,
  format,
  height = 200,
  ariaLabel,
  highlightFirst,
}: {
  labels: string[];
  tooltipTitles?: string[];
  series: ChartSeries[];
  format: (n: number) => string;
  height?: number;
  ariaLabel: string;
  /** Emphasise column 0 (e.g. "today") with a bolder label. */
  highlightFirst?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const ticks = niceTicks(Math.max(0, ...totals), 3);
  const top = ticks[ticks.length - 1] || 1;
  const m = { l: 36, r: 8, t: 10, b: 26 };
  const w = width - m.l - m.r;
  const h = height - m.t - m.b;
  const band = w / Math.max(1, n);
  const bw = Math.min(24, band * 0.62);
  const y = (v: number) => m.t + h - (v / top) * h;

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'} strokeWidth={1} />
            <text x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--viz-muted)" className="tabular-nums">
              {format(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) => {
          const cx = m.l + band * i + band / 2;
          let acc = 0;
          const segs = series
            .map((s) => ({ s, v: s.values[i] ?? 0 }))
            .filter((x) => x.v > 0);
          return (
            <g key={i} opacity={hover === null || hover === i ? 1 : 0.55}>
              {segs.map(({ s, v }, k) => {
                const y0 = y(acc);
                acc += v;
                const y1 = y(acc);
                const isTop = k === segs.length - 1;
                // 2px surface gap between stacked segments.
                const gap = k > 0 ? 2 : 0;
                const hgt = Math.max(0, y0 - y1 - gap);
                return isTop ? (
                  <path key={s.key} d={barPath(cx - bw / 2, y1, bw, hgt)} fill={s.color} />
                ) : (
                  <rect key={s.key} x={cx - bw / 2} y={y1} width={bw} height={hgt} fill={s.color} />
                );
              })}
              {(n <= 16 || i % 2 === 0) && (
                <text x={cx} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--viz-muted)" fontWeight={highlightFirst && i === 0 ? 700 : 400}>
                  {l}
                </text>
              )}
              <rect
                x={m.l + band * i}
                y={m.t}
                width={band}
                height={h}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <Tooltip
          x={m.l + band * hover + band / 2}
          y={m.t}
          width={width}
          title={tooltipTitles?.[hover] ?? labels[hover]}
          rows={series.map((s) => ({ label: s.label, value: format(s.values[hover] ?? 0), color: s.color }))}
        />
      )}
    </div>
  );
}

// --- horizontal bars -------------------------------------------------------------

export interface HBarRow {
  key: string;
  label: ReactNode;
  value: number;
  display: string;
  color?: string;
  /** Second line in the tooltip, e.g. "6 invoices". */
  detail?: string;
}

/** Labelled horizontal bars, values printed at the end. Good for ranked or ordered categories. */
export function HBarList({
  rows,
  color = 'rgb(var(--color-accent, 47 122 132))',
  ariaLabel,
  scaleMax,
}: {
  rows: HBarRow[];
  color?: string;
  ariaLabel: string;
  /** Share a scale with another list (e.g. two columns of one ranking). */
  scaleMax?: number;
}) {
  const max = Math.max(1, scaleMax ?? 0, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5" aria-label={ariaLabel}>
      {rows.map((r) => (
        <li key={r.key} className="group" title={r.detail}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-ink/75">{r.label}</span>
            <span className="tabular-nums font-semibold text-ink">{r.display}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-r bg-paper">
            <div
              className="h-full rounded-r transition-[width] duration-500"
              style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? color, minWidth: r.value > 0 ? 3 : 0 }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Two measures per row on one scale (e.g. demand vs supply), direct-labelled. */
export function PairedBars({
  rows,
  a,
  b,
  ariaLabel,
}: {
  rows: { key: string; label: string; a: number; b: number }[];
  a: { label: string; color: string };
  b: { label: string; color: string };
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const labelW = Math.min(110, width * 0.3);
  const valueW = 28;
  const barH = 9;
  const rowH = 32;
  const max = Math.max(1, ...rows.flatMap((r) => [r.a, r.b]));
  const w = width - labelW - valueW - 8;
  const height = rows.length * rowH;
  return (
    <div ref={ref} className="relative">
      <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block">
        {rows.map((r, i) => {
          const y0 = i * rowH + 5;
          return (
            <g key={r.key} opacity={hover === null || hover === i ? 1 : 0.55} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={0} y={i * rowH} width={width} height={rowH} fill="transparent" />
              <text x={0} y={y0 + barH + 1} dy="0.32em" fontSize={12} fill="currentColor" className="text-ink/80">
                {r.label.length > 16 ? `${r.label.slice(0, 15)}…` : r.label}
              </text>
              <path d={hbarPath(labelW, y0, (r.a / max) * w, barH)} fill={a.color} />
              <text x={labelW + (r.a / max) * w + 4} y={y0 + barH / 2} dy="0.32em" fontSize={11} fill="var(--viz-muted)" className="tabular-nums">
                {r.a}
              </text>
              <path d={hbarPath(labelW, y0 + barH + 2, (r.b / max) * w, barH)} fill={b.color} />
              <text x={labelW + (r.b / max) * w + 4} y={y0 + barH * 1.5 + 2} dy="0.32em" fontSize={11} fill="var(--viz-muted)" className="tabular-nums">
                {r.b}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <Tooltip
          x={labelW}
          y={hover * rowH + rowH}
          width={width}
          title={rows[hover].label}
          rows={[
            { label: a.label, value: String(rows[hover].a), color: a.color },
            { label: b.label, value: String(rows[hover].b), color: b.color },
          ]}
        />
      )}
    </div>
  );
}

// --- funnel ------------------------------------------------------------------------

/** Ordered stages, each bar a darker step of one hue, with the step-to-step rate between them. */
export function Funnel({
  stages,
  rateLabel,
  ariaLabel,
}: {
  stages: { key: string; label: string; value: number }[];
  /** e.g. (pct) => `${pct}% moved on` */
  rateLabel: (pct: number) => string;
  ariaLabel: string;
}) {
  const ramp = ['var(--viz-ramp-1)', 'var(--viz-ramp-2)', 'var(--viz-ramp-3)', 'var(--viz-ramp-4)', 'var(--viz-ramp-5)'];
  const max = Math.max(1, stages[0]?.value ?? 1);
  return (
    <ol className="space-y-1.5" aria-label={ariaLabel}>
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        const pct = prev ? Math.round((s.value / prev) * 100) : null;
        return (
          <li key={s.key}>
            {pct !== null && <div className="py-0.5 pl-2 text-[11px] text-ink/50">↓ {rateLabel(pct)}</div>}
            <div className="flex items-center gap-3">
              <div className="w-24 shrink-0 text-xs text-ink/75">{s.label}</div>
              <div className="relative h-7 flex-1">
                <div
                  className="h-full rounded-r transition-[width] duration-500"
                  style={{ width: `${Math.max(2, (s.value / max) * 100)}%`, background: ramp[Math.min(i + 1, ramp.length - 1)] }}
                />
              </div>
              <div className="w-10 text-right text-sm font-semibold tabular-nums text-ink">{s.value}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// --- gauge ---------------------------------------------------------------------------

export type HealthLevel = 'good' | 'watch' | 'act';

const LEVEL_STYLE: Record<HealthLevel, { color: string; text: string; Icon: typeof CheckCircle2 }> = {
  good: { color: 'var(--viz-good)', text: 'var(--viz-good-text)', Icon: CheckCircle2 },
  watch: { color: 'var(--viz-warning)', text: '#7a5200', Icon: AlertTriangle },
  act: { color: 'var(--viz-critical)', text: '#a12a2a', Icon: AlertOctagon },
};

/**
 * A half-circle dial for a 0..1 ratio. The arc is coloured by health level,
 * and the level is also spelled out with an icon underneath - colour never
 * carries the meaning alone. Target ticks show where "good" starts.
 */
export function Gauge({
  value,
  target,
  level,
  levelLabel,
  label,
  detail,
  emptyLabel,
}: {
  value: number | null;
  /** Where "good" begins, 0..1; drawn as a tick on the track. */
  target: number;
  level: HealthLevel | null;
  levelLabel: string;
  label: string;
  detail: string;
  emptyLabel: string;
}) {
  const size = 148;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const clamped = value === null ? 0 : Math.max(0, Math.min(1, value));
  const pt = (f: number) => {
    const a = Math.PI * (1 - f);
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)] as const;
  };
  const [sx, sy] = pt(0);
  const [ex, ey] = pt(1);
  const [vx, vy] = pt(clamped);
  const [tx1, ty1] = [cx + (r - stroke) * Math.cos(Math.PI * (1 - target)), cy - (r - stroke) * Math.sin(Math.PI * (1 - target))];
  const [tx2, ty2] = [cx + (r + stroke) * Math.cos(Math.PI * (1 - target)), cy - (r + stroke) * Math.sin(Math.PI * (1 - target))];
  const style = level ? LEVEL_STYLE[level] : null;
  const pct = value === null ? null : Math.round(value * 100);

  return (
    <figure className="flex flex-col items-center text-center" title={detail}>
      <svg width={size} height={size / 2 + 8} viewBox={`0 0 ${size} ${size / 2 + 8}`} role="img" aria-label={`${label}: ${pct === null ? emptyLabel : `${pct}%`}. ${levelLabel}`}>
        <path d={`M${sx},${sy}A${r},${r} 0 0 1 ${ex},${ey}`} fill="none" stroke="var(--viz-grid)" strokeWidth={stroke} strokeLinecap="round" />
        {value !== null && clamped > 0.005 && (
          <path
            d={`M${sx},${sy}A${r},${r} 0 0 1 ${vx},${vy}`}
            fill="none"
            stroke={style?.color ?? 'var(--viz-series-1)'}
            strokeWidth={stroke}
            strokeLinecap="round"
            className="transition-all duration-700"
          />
        )}
        <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} stroke="#374046" strokeWidth={2} strokeLinecap="round" opacity={0.55} />
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={26} fontWeight={700} fill="#374046" className="tabular-nums">
          {pct === null ? '—' : `${pct}%`}
        </text>
      </svg>
      <figcaption className="mt-1 space-y-1">
        <div className="text-sm font-semibold text-ink">{label}</div>
        {style ? (
          <div className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: style.text }}>
            <style.Icon className="h-3.5 w-3.5" aria-hidden style={{ color: style.color }} />
            {levelLabel}
          </div>
        ) : (
          <div className="text-xs text-ink/50">{emptyLabel}</div>
        )}
        <div className="text-[11px] leading-snug text-ink/55">{detail}</div>
      </figcaption>
    </figure>
  );
}

// --- split bar (share of a whole) ---------------------------------------------------

export function SplitBar({ parts }: { parts: { key: string; label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const shown = useMemo(() => parts.filter((p) => p.value > 0), [parts]);
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded">
        {total === 0 ? (
          <div className="h-full w-full bg-paper" />
        ) : (
          shown.map((p) => <div key={p.key} className="h-full" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${p.value}`} />)
        )}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/70">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} aria-hidden />
            {p.label}
            <span className={cn('tabular-nums font-semibold text-ink')}>
              {p.value}
              {total > 0 && <span className="ml-1 font-normal text-ink/50">({Math.round((p.value / total) * 100)}%)</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
