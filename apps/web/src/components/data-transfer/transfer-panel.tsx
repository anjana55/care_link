'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { useLocationTree } from '@/lib/hooks/use-caregivers';
import { useDownloadTemplate, useExportCsv, useImportCsv, type ImportIssue, type ImportReport, type ImportRowResult, type TransferKind } from '@/lib/hooks/use-data-transfer';
import { CAREGIVER_STATUS_OPTIONS } from '@/lib/caregiver-status';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const CLIENT_STATUSES = ['PENDING_REVIEW', 'ACTIVE', 'INACTIVE', 'SUSPENDED'];

/**
 * The columns an import needs, and the codes the option columns take - the
 * same lists the API reads (data-transfer/*-transfer.service.ts). Options are
 * also matched by their words ("Phone call", "WhatsApp"), case-insensitively.
 */
const GUIDE: Record<TransferKind, { required: string[]; options: [string, string][] }> = {
  caregivers: {
    required: ['Full name', 'Date of birth', 'Gender', 'Civil status', 'Primary phone', 'Permanent address', 'Emergency contact name', 'Emergency contact number', 'Emergency contact relationship'],
    options: [
      ['Gender', 'MALE, FEMALE, OTHER'],
      ['Civil status', 'SINGLE, MARRIED, DIVORCED, WIDOWED, OTHER'],
      ['Preferred contact', 'PHONE_CALL, WHATSAPP'],
      ['Skills / Languages', 'Bathing Assistance; Dementia Care'],
    ],
  },
  clients: {
    required: ['Full name', 'Email / Phone'],
    options: [
      ['Status', 'ACTIVE, INACTIVE'],
      ['Preferred contact', 'PHONE_CALL, WHATSAPP, EMAIL'],
      ['Preferred contact time', 'ANYTIME, MORNING, AFTERNOON, EVENING'],
      ['Registering for', 'SELF, GUARDIAN'],
      ['Care recipient relationship', 'PARENT, SPOUSE, CHILD, SIBLING, OTHER_RELATIVE, FRIEND, OTHER'],
      ['Care schedule', 'DAY, NIGHT, LIVE_IN_24H, NOT_SURE'],
      ['Care start', 'IMMEDIATELY, WITHIN_WEEK, WITHIN_MONTH, JUST_EXPLORING'],
      ['Preferred caregiver gender', 'NO_PREFERENCE, MALE, FEMALE'],
    ],
  },
};

type RowFilter = 'all' | 'problems';

function OutcomeBadge({ outcome }: { outcome: ImportRowResult['outcome'] }) {
  const { t } = useTranslation();
  const styles: Record<ImportRowResult['outcome'], string> = {
    READY: 'bg-brand-light text-brand-dark',
    CREATED: 'bg-brand-light text-brand-dark',
    DUPLICATE: 'bg-accent-light text-accent',
    ERROR: 'bg-danger-light text-danger',
  };
  return <span className={cn('inline-flex whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium', styles[outcome])}>{t(`dataTransfer.outcome.${outcome}`)}</span>;
}

/**
 * Export (with the list filters) and import (template, check, then import)
 * for one kind of record. The check is a dry run of the real import: the same
 * validation and duplicate checks, nothing written.
 */
export function TransferPanel({ kind }: { kind: TransferKind }) {
  const { t, locale } = useTranslation();
  const { data: tree = [] } = useLocationTree(locale);
  const districts = useMemo(() => tree.flatMap((p) => p.districts).sort((a, b) => a.name.localeCompare(b.name)), [tree]);
  const exporter = useExportCsv(kind);
  const template = useDownloadTemplate(kind);
  const importer = useImportCsv(kind);

  const [status, setStatus] = useState('');
  const [districtId, setDistrictId] = useState('');
  const [search, setSearch] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [rowFilter, setRowFilter] = useState<RowFilter>('all');
  const fileInput = useRef<HTMLInputElement>(null);

  const statuses = kind === 'caregivers' ? CAREGIVER_STATUS_OPTIONS : CLIENT_STATUSES;
  const guide = GUIDE[kind];

  const run = (dryRun: boolean) => {
    if (!file) return;
    importer.mutate({ file, dryRun }, { onSuccess: (r) => setReport(r) });
  };

  const reset = () => {
    setFile(null);
    setReport(null);
    importer.reset();
    if (fileInput.current) fileInput.current.value = '';
  };

  const describe = (issue: ImportIssue) => {
    const code = issue.code === 'duplicate' && !issue.params?.match ? 'duplicateBare' : issue.code;
    const text = t(`dataTransfer.issues.${code}`, {
      column: issue.column ?? '',
      value: issue.value ?? '',
      max: issue.params?.max ?? '',
      row: issue.params?.row ?? '',
      match: issue.params?.match ?? '',
      message: issue.params?.message ?? '',
    });
    return issue.params?.allowed ? `${text} ${t('dataTransfer.issues.allowed', { allowed: issue.params.allowed })}` : text;
  };

  const rows = report ? report.rows.filter((r) => rowFilter === 'all' || r.outcome === 'ERROR' || r.outcome === 'DUPLICATE' || r.warnings.length > 0) : [];
  const committed = report && !report.dryRun;
  const detailHref = (r: ImportRowResult) => (kind === 'caregivers' ? `/caregivers/${r.id}` : `/clients/${r.id}`);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download size={18} aria-hidden className="text-brand" />
            {t(`dataTransfer.${kind}.exportTitle`)}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-ink/60">{t(`dataTransfer.${kind}.exportHint`)}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor={`${kind}-status`}>{t('dataTransfer.status')}</Label>
              <Select id={`${kind}-status`} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">{t('dataTransfer.allStatuses')}</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {t(`${kind}.status.${s}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`${kind}-district`}>{t('dataTransfer.district')}</Label>
              <Select id={`${kind}-district`} value={districtId} onChange={(e) => setDistrictId(e.target.value)}>
                <option value="">{t('dataTransfer.allDistricts')}</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`${kind}-search`}>{t('dataTransfer.search')}</Label>
              <Input id={`${kind}-search`} value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} placeholder={t(`dataTransfer.${kind}.searchPlaceholder`)} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => exporter.mutate({ status: status || undefined, districtId: districtId ? Number(districtId) : undefined, search: search.trim() || undefined })} disabled={exporter.isPending}>
              <Download size={16} aria-hidden className="mr-1.5" />
              {exporter.isPending ? t('dataTransfer.preparing') : t('dataTransfer.downloadCsv')}
            </Button>
            <span className="text-xs text-ink/50">{t('dataTransfer.exportPrivacy')}</span>
          </div>
          {exporter.isError && <p className="text-sm text-danger">{exporter.error instanceof Error ? exporter.error.message : t('common.actionFailed')}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload size={18} aria-hidden className="text-brand" />
            {t(`dataTransfer.${kind}.importTitle`)}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <ol className="grid gap-4 md:grid-cols-3">
            <li className="rounded border border-border p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t('dataTransfer.step', { n: 1 })}</div>
              <p className="mt-1 text-sm text-ink">{t('dataTransfer.step1')}</p>
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => template.mutate()} disabled={template.isPending}>
                <FileSpreadsheet size={14} aria-hidden className="mr-1.5" />
                {t('dataTransfer.downloadTemplate')}
              </Button>
            </li>
            <li className="rounded border border-border p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t('dataTransfer.step', { n: 2 })}</div>
              <p className="mt-1 text-sm text-ink">{t(`dataTransfer.${kind}.step2`)}</p>
            </li>
            <li className="rounded border border-border p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t('dataTransfer.step', { n: 3 })}</div>
              <p className="mt-1 text-sm text-ink">{t('dataTransfer.step3')}</p>
            </li>
          </ol>

          <details className="rounded border border-border bg-paper/60 p-4 text-sm">
            <summary className="cursor-pointer font-medium text-ink">{t('dataTransfer.guideTitle')}</summary>
            <div className="mt-3 space-y-3 text-ink/80">
              <p>
                <span className="font-medium text-ink">{t('dataTransfer.requiredColumns')}:</span> {guide.required.join(', ')}
              </p>
              <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[14rem_1fr]">
                {guide.options.map(([column, values]) => (
                  <div key={column} className="contents">
                    <dt className="font-medium text-ink">{column}</dt>
                    <dd className="font-mono text-xs leading-6">{values}</dd>
                  </div>
                ))}
              </dl>
              <ul className="list-disc space-y-1 pl-5">
                <li>{t('dataTransfer.guideDates')}</li>
                <li>{t('dataTransfer.guideLocation')}</li>
                <li>{t(`dataTransfer.${kind}.guideDuplicates`)}</li>
                <li>{t(`dataTransfer.${kind}.guideResult`)}</li>
              </ul>
            </div>
          </details>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <Label htmlFor={`${kind}-file`}>{t('dataTransfer.file')}</Label>
              <Input
                id={`${kind}-file`}
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setReport(null);
                  importer.reset();
                }}
              />
            </div>
            <Button variant="secondary" onClick={() => run(true)} disabled={!file || importer.isPending}>
              {importer.isPending && importer.variables?.dryRun ? t('dataTransfer.checking') : t('dataTransfer.check')}
            </Button>
            {(report || file) && (
              <Button variant="ghost" onClick={reset}>
                {t('dataTransfer.startOver')}
              </Button>
            )}
          </div>
          {importer.isError && <p className="text-sm text-danger">{importer.error instanceof Error ? importer.error.message : t('common.actionFailed')}</p>}

          {report && (
            <div className="space-y-4">
              <div className={cn('flex flex-wrap items-center gap-x-6 gap-y-2 rounded border p-4 text-sm', committed ? 'border-brand/40 bg-brand-light/40' : 'border-border bg-paper/60')}>
                <span className="font-medium text-ink">{committed ? t('dataTransfer.doneTitle') : t('dataTransfer.checkedTitle', { n: report.total })}</span>
                <span className="inline-flex items-center gap-1.5 text-brand-dark">
                  <CheckCircle2 size={16} aria-hidden />
                  {committed ? t('dataTransfer.summary.created', { n: report.created }) : t('dataTransfer.summary.ready', { n: report.ready })}
                </span>
                <span className="inline-flex items-center gap-1.5 text-accent">
                  <AlertTriangle size={16} aria-hidden />
                  {t('dataTransfer.summary.duplicates', { n: report.duplicates })}
                </span>
                <span className="inline-flex items-center gap-1.5 text-danger">
                  <XCircle size={16} aria-hidden />
                  {t('dataTransfer.summary.errors', { n: report.errors })}
                </span>
              </div>
              {report.ignoredColumns.length > 0 && <p className="text-xs text-ink/60">{t('dataTransfer.ignoredColumns', { columns: report.ignoredColumns.join(', ') })}</p>}

              {!committed && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={() => run(false)} disabled={report.ready === 0 || importer.isPending}>
                    <Upload size={16} aria-hidden className="mr-1.5" />
                    {importer.isPending ? t('dataTransfer.importing') : t('dataTransfer.importN', { n: report.ready })}
                  </Button>
                  <span className="text-xs text-ink/60">{report.ready === 0 ? t('dataTransfer.nothingToImport') : t('dataTransfer.importHint')}</span>
                </div>
              )}

              <div className="flex items-center gap-2 text-sm">
                {(['all', 'problems'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setRowFilter(f)}
                    className={cn('rounded-full border px-3 py-1', rowFilter === f ? 'border-brand bg-brand-light text-brand-dark' : 'border-border text-ink/70 hover:text-ink')}
                  >
                    {t(`dataTransfer.filter.${f}`)}
                  </button>
                ))}
              </div>

              <div className="overflow-x-auto rounded border border-border">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead className="bg-paper text-xs uppercase tracking-wide text-ink/50">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t('dataTransfer.table.row')}</th>
                      <th className="px-3 py-2 font-medium">{t('dataTransfer.table.name')}</th>
                      <th className="px-3 py-2 font-medium">{t('dataTransfer.table.result')}</th>
                      <th className="px-3 py-2 font-medium">{t('dataTransfer.table.details')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((r) => (
                      <tr key={r.row} className="align-top">
                        <td className="px-3 py-2 tabular-nums text-ink/60">{r.row}</td>
                        <td className="px-3 py-2 text-ink">
                          {r.outcome === 'CREATED' && r.id ? (
                            <Link href={detailHref(r)} className="font-medium text-brand-dark hover:underline">
                              {r.name || '-'}
                            </Link>
                          ) : (
                            r.name || <span className="text-ink/40">-</span>
                          )}
                          {r.reference && <div className="text-xs text-ink/50">{r.reference}</div>}
                        </td>
                        <td className="px-3 py-2">
                          <OutcomeBadge outcome={r.outcome} />
                        </td>
                        <td className="px-3 py-2">
                          <ul className="space-y-0.5">
                            {r.errors.map((issue, i) => (
                              <li key={`e${i}`} className={r.outcome === 'DUPLICATE' ? 'text-accent' : 'text-danger'}>
                                {describe(issue)}
                              </li>
                            ))}
                            {r.warnings.map((issue, i) => (
                              <li key={`w${i}`} className="text-ink/60">
                                {describe(issue)}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-ink/50">
                          {t('dataTransfer.noProblems')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
