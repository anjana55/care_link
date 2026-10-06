'use client';

import { useRef, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { ApiError, fetchBlob } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Label, Select } from '@/components/ui/input';
import { VerificationBadge, isWithdrawable } from '@/components/portal/status-badge';
import { useCaregiverId, useDeleteDocument, useDocuments, useUploadDocument } from '@/lib/hooks/use-caregiver-portal';
import { DOCUMENT_TYPES, type CaregiverDocument, type DocumentType } from '@/lib/api/portal-types';

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp';
const EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp']);

/** What staff look for before they can verify a registration. */
const CORE: { label: string; anyOf: DocumentType[] }[] = [
  { label: 'identity', anyOf: ['NIC', 'PASSPORT'] },
  { label: 'police', anyOf: ['POLICE_CLEARANCE'] },
  { label: 'gn', anyOf: ['GRAMA_NILADHARI_CERTIFICATE'] },
];

const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * The caregiver's own document file: what staff need, what has been uploaded,
 * and where each one stands.
 *
 * Checks the file here (type and size) so the common mistakes are caught before
 * a 10 MB upload, but the API checks again - including that the bytes really are
 * the type they claim - so nothing here is relied on for safety.
 *
 * Opening a file goes through fetchBlob rather than a link: the file route needs
 * the Authorization header, which a link cannot send.
 */
export default function CaregiverDocumentsPage() {
  const { t } = useTranslation();
  const caregiverId = useCaregiverId();
  const { data: documents, isLoading, isError } = useDocuments();
  const upload = useUploadDocument();
  const remove = useDeleteDocument();
  const fileInput = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<DocumentType>('NIC');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const onPick = (picked: File | null) => {
    setNotice(null);
    setError(null);
    setFile(null);
    if (!picked) return;
    const ext = picked.name.split('.').pop()?.toLowerCase() ?? '';
    if (!EXTENSIONS.has(ext)) return setError(t('portal.documents.badType'));
    if (picked.size > MAX_BYTES) return setError(t('portal.documents.tooLarge'));
    setFile(picked);
  };

  const onUpload = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return setError(t('portal.documents.chooseFile'));
    setError(null);
    upload.mutate(
      { file, documentType: type },
      {
        onSuccess: () => {
          setNotice(t('portal.documents.uploaded'));
          setFile(null);
          if (fileInput.current) fileInput.current.value = '';
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : t('portal.saveError')),
      },
    );
  };

  const open = async (doc: CaregiverDocument) => {
    setError(null);
    try {
      const blob = await fetchBlob(`/caregivers/${caregiverId}/documents/${doc.id}/file`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      // Long enough for the new tab to read it; the blob is only this caregiver's own file.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError(t('portal.documents.openError'));
    }
  };

  const onRemove = (doc: CaregiverDocument) => {
    if (!window.confirm(t('portal.documents.confirmRemove'))) return;
    setError(null);
    remove.mutate(doc.id, {
      onSuccess: () => setNotice(t('portal.documents.removed')),
      onError: (err) => setError(err instanceof ApiError ? err.message : t('portal.saveError')),
    });
  };

  const have = (types: DocumentType[]) => (documents ?? []).some((d) => types.includes(d.documentType));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">{t('portal.documents.title')}</h1>
        <p className="mt-1 text-sm text-ink/60">{t('portal.documents.subtitle')}</p>
      </div>

      <section className="rounded-lg border border-border bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink">{t('portal.documents.needed')}</h2>
        <ul className="space-y-2">
          {CORE.map((item) => {
            const done = have(item.anyOf);
            return (
              <li key={item.label} className="flex items-center gap-3 text-sm">
                <span aria-hidden="true" className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${done ? 'bg-brand text-white' : 'border border-border text-transparent'}`}>✓</span>
                <span className={done ? 'text-ink' : 'text-ink/70'}>{t(`portal.documents.core.${item.label}`)}</span>
                <span className="sr-only">{done ? t('portal.documents.haveIt') : t('portal.documents.missing')}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <form onSubmit={onUpload} className="rounded-lg border border-border bg-white p-5" noValidate>
        <h2 className="mb-3 text-sm font-semibold text-ink">{t('portal.documents.add')}</h2>
        <div className="grid gap-4 sm:grid-cols-[1fr_1.5fr_auto] sm:items-end">
          <div>
            <Label htmlFor="documentType">{t('portal.documents.type')}</Label>
            <Select id="documentType" value={type} onChange={(e) => setType(e.target.value as DocumentType)}>
              {DOCUMENT_TYPES.map((d) => (
                <option key={d} value={d}>{t(`portal.documents.types.${d}`)}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="documentFile">{t('portal.documents.file')}</Label>
            <input
              id="documentFile"
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-ink file:mr-3 file:rounded file:border file:border-border file:bg-paper file:px-3 file:py-2 file:text-sm"
            />
          </div>
          <Button type="submit" disabled={upload.isPending || !file}>
            {upload.isPending ? t('common.loading') : t('portal.documents.upload')}
          </Button>
        </div>
        <p className="mt-2 text-xs text-ink/50">{t('portal.documents.fileHint')}</p>
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        {notice && <p role="status" className="mt-3 text-sm text-brand-dark">{notice}</p>}
      </form>

      <section className="rounded-lg border border-border bg-white">
        <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-ink">{t('portal.documents.yours')}</h2>
        {isLoading && <p className="px-5 py-4 text-sm text-ink/60">{t('common.loading')}</p>}
        {isError && <p role="alert" className="px-5 py-4 text-sm text-danger">{t('portal.loadError')}</p>}
        {documents && documents.length === 0 && <p className="px-5 py-4 text-sm text-ink/60">{t('portal.documents.none')}</p>}
        <ul className="divide-y divide-border">
          {documents?.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{t(`portal.documents.types.${doc.documentType}`)}</p>
                <p className="truncate text-xs text-ink/50">
                  {doc.originalFilename} · {size(doc.sizeBytes)} · {new Date(doc.createdAt).toLocaleDateString()}
                </p>
                {doc.verificationStatus === 'REJECTED' && (
                  <p className="mt-1 text-xs text-red-700">{t('portal.documents.rejectedHint')}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <VerificationBadge status={doc.verificationStatus} />
                <button type="button" onClick={() => open(doc)} className="text-sm font-medium text-brand-dark hover:underline">
                  {t('portal.documents.view')}
                  <span className="sr-only"> {doc.originalFilename}</span>
                </button>
                {isWithdrawable(doc.verificationStatus) && (
                  <button type="button" onClick={() => onRemove(doc)} disabled={remove.isPending} className="text-sm text-danger hover:underline disabled:opacity-50">
                    {t('portal.documents.remove')}
                    <span className="sr-only"> {doc.originalFilename}</span>
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
