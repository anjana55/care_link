'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export type TransferKind = 'caregivers' | 'clients';

export interface ImportIssue {
  code: 'required' | 'invalid' | 'tooLong' | 'duplicate' | 'duplicateFile' | 'notFound' | 'needsEmail' | 'needsContact' | 'fixedPhone' | 'failed';
  column?: string;
  value?: string;
  params?: Record<string, string | number>;
}

export interface ImportRowResult {
  row: number;
  name: string;
  outcome: 'READY' | 'CREATED' | 'DUPLICATE' | 'ERROR';
  errors: ImportIssue[];
  warnings: ImportIssue[];
  id?: string;
  reference?: string;
}

export interface ImportReport {
  dryRun: boolean;
  total: number;
  ready: number;
  created: number;
  duplicates: number;
  errors: number;
  ignoredColumns: string[];
  missingColumns: string[];
  rows: ImportRowResult[];
}

/** Hands a downloaded Blob to the browser as a file. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const today = () => new Date().toISOString().slice(0, 10);

export function useExportCsv(kind: TransferKind) {
  return useMutation({
    mutationFn: async (filter: { status?: string; districtId?: number; search?: string }) => {
      const blob = await api.download(`/data-transfer/${kind}/export`, filter);
      saveBlob(blob, `${kind}-${today()}.csv`);
    },
  });
}

export function useDownloadTemplate(kind: TransferKind) {
  return useMutation({
    mutationFn: async () => saveBlob(await api.download(`/data-transfer/${kind}/template`), `${kind}-template.csv`),
  });
}

/** dryRun: check the file and report; otherwise create the rows that pass. */
export function useImportCsv(kind: TransferKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, dryRun }: { file: File; dryRun: boolean }) => {
      const form = new FormData();
      form.append('dryRun', String(dryRun));
      form.append('file', file);
      return api.upload<ImportReport>(`/data-transfer/${kind}/import`, form);
    },
    onSuccess: (report) => {
      if (!report.dryRun && report.created > 0) {
        queryClient.invalidateQueries({ queryKey: [kind] });
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      }
    },
  });
}
