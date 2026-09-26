'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { Select, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Upload, FileCheck } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';

const DOCUMENT_TYPES = [
  'NIC',
  'PASSPORT',
  'GRAMA_NILADHARI_CERTIFICATE',
  'POLICE_CLEARANCE',
  'CAREGIVER_CERTIFICATE',
  'NVQ_CERTIFICATE',
  'NURSING_CERTIFICATE',
  'CV',
  'OTHER',
];

interface DocumentRow {
  id: string;
  documentType: string;
  originalFilename: string;
  verificationStatus: string;
}

export function DocumentsStep({
  caregiverId,
  onNext,
  onBack,
  hideNav = false,
}: {
  caregiverId: string;
  onNext?: () => void;
  onBack?: () => void;
  hideNav?: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [documentType, setDocumentType] = useState('NIC');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: documents, isLoading } = useQuery({
    queryKey: ['documents', caregiverId],
    queryFn: () => api.get<DocumentRow[]>(`/caregivers/${caregiverId}/documents`),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('documentType', documentType);
      formData.append('file', file);
      return api.upload(`/caregivers/${caregiverId}/documents`, formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', caregiverId] });
      setError(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Upload failed'),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {isLoading && <p className="text-sm text-ink/50">{t('common.loading')}</p>}
        {documents?.map((d) => (
          <div key={d.id} className="flex items-center justify-between rounded border border-border px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm text-ink">
              <FileCheck size={15} className="text-brand" />
              {d.documentType.replace('_', ' ')} <span className="text-ink/40">· {d.originalFilename}</span>
            </div>
            <span className="text-xs text-ink/50">{d.verificationStatus}</span>
          </div>
        ))}
        {documents?.length === 0 && <p className="text-sm text-ink/40">{t('caregivers.me.documents.noDocumentsYet')}</p>}
      </div>

      <div className="rounded border border-dashed border-border p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Label>{t('caregivers.me.documents.documentType')}</Label>
            <Select value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
              {DOCUMENT_TYPES.map((d) => (
                <option key={d} value={d}>
                  {d.replace('_', ' ')}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>{t('caregivers.me.documents.fileLabel')}</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadMutation.mutate(file);
              }}
              className="text-sm text-ink/70 file:mr-3 file:rounded file:border-0 file:bg-brand-light file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-dark"
            />
          </div>
          {uploadMutation.isPending && (
            <span className="flex items-center gap-1 text-xs text-ink/50">
              <Upload size={13} /> {t('caregivers.me.documents.uploading')}
            </span>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </div>

      {!hideNav && (
        <div className="flex justify-between border-t border-border pt-4">
          <Button type="button" variant="secondary" onClick={onBack}>
            {t('caregivers.wizard.back')}
          </Button>
          <Button type="button" onClick={onNext}>
            {t('caregivers.wizard.next')}
          </Button>
        </div>
      )}
    </div>
  );
}