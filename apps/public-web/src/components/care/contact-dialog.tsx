'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, X } from 'lucide-react';
import { CARE_REQUEST_MESSAGE_MAX, careTypeValues, type CareType, type ClientCareRequest, type CreateCareRequestBody } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { ApiError } from '@/lib/api/client';
import { useSendRequest } from '@/lib/hooks/use-client-care';
import { useCities, useLocationTree } from '@/lib/hooks/use-public-search';
import { loadSearch } from '@/lib/care-intent';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';

interface ContactDialogProps {
  open: boolean;
  /** The caregiver to contact. Left out, the dialog asks our team to find someone instead. */
  caregiverPublicId?: string;
  onClose: () => void;
}

/** What the client last searched for, as request details: carried into either kind of request. */
function detailsFromLastSearch(): Pick<CreateCareRequestBody, 'careType' | 'districtId' | 'cityId' | 'desiredStartDate'> {
  const request = loadSearch()?.request;
  if (!request) return {};
  return {
    careType: request.careType,
    districtId: request.location?.districtId,
    cityId: request.location?.cityId,
    desiredStartDate: request.desiredStartDate,
  };
}

/**
 * Sends a care request for a signed-in client. Contact is staff-mediated: this
 * only tells our team, who then call both sides, so the dialog says so up front.
 *
 * Two shapes:
 * - with a caregiver ("Contact this caregiver"): just an optional note; what
 *   the client searched for (care type, place, start) rides along silently;
 * - without one ("Find a caregiver for me"): the client tells us the type of
 *   care and where - prefilled from their last search - and our team matches.
 */
export function ContactDialog({ open, caregiverPublicId, onClose }: ContactDialogProps) {
  const { t, locale } = useTranslation();
  const send = useSendRequest();
  const findForMe = !caregiverPublicId;
  const [message, setMessage] = useState('');
  const [careType, setCareType] = useState<CareType | ''>('');
  const [districtId, setDistrictId] = useState('');
  const [cityId, setCityId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [sent, setSent] = useState<ClientCareRequest | null>(null);
  const firstField = useRef<HTMLTextAreaElement>(null);
  const careTypeField = useRef<HTMLSelectElement>(null);

  const { data: tree = [] } = useLocationTree(locale);
  const districts = useMemo(() => tree.flatMap((p) => p.districts).sort((a, b) => a.name.localeCompare(b.name, locale)), [tree, locale]);
  const { data: cities = [] } = useCities(findForMe && districtId ? Number(districtId) : null, locale);
  const sortedCities = useMemo(() => [...cities].sort((a, b) => a.name.localeCompare(b.name, locale)), [cities, locale]);

  useEffect(() => {
    if (!open) return;
    setSent(null);
    setMessage('');
    setSubmitted(false);
    const last = detailsFromLastSearch();
    setCareType(last.careType ?? '');
    setDistrictId(last.districtId ? String(last.districtId) : '');
    setCityId(last.cityId ? String(last.cityId) : '');
    setStartDate(last.desiredStartDate ?? '');
    send.reset();
    // Focus the first thing to fill in, so keyboard users land inside the dialog.
    const id = window.setTimeout(() => (findForMe && !last.careType ? careTypeField.current?.focus() : firstField.current?.focus()), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('keydown', onKey);
    };
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const remaining = CARE_REQUEST_MESSAGE_MAX - message.length;
  const errors = findForMe
    ? {
        careType: !careType ? t('care.findDialog.careTypeRequired') : undefined,
        district: !districtId ? t('care.findDialog.districtRequired') : undefined,
      }
    : {};
  const shown = (key: keyof typeof errors) => (submitted ? errors[key] : undefined);

  const submit = () => {
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) return;
    const body: CreateCareRequestBody = findForMe
      ? {
          message: message.trim() || undefined,
          careType: careType || undefined,
          districtId: districtId ? Number(districtId) : undefined,
          cityId: cityId ? Number(cityId) : undefined,
          desiredStartDate: startDate || undefined,
        }
      : { caregiverPublicId, message: message.trim() || undefined, ...detailsFromLastSearch() };
    send.mutate(body, { onSuccess: (request) => setSent(request) });
  };
  const error = send.error instanceof ApiError && send.error.message ? send.error.message : send.error ? t('care.dialog.error') : null;
  const prefix = findForMe ? 'care.findDialog' : 'care.dialog';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="contact-dialog-title"
      onClick={onClose}
    >
      <div className="max-h-[95vh] w-full max-w-md overflow-y-auto rounded-t-lg bg-white p-6 shadow-xl sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
        {sent ? (
          <div className="text-center" role="status" aria-live="polite">
            <CheckCircle2 className="mx-auto h-10 w-10 text-brand" aria-hidden />
            <h2 id="contact-dialog-title" className="mt-3 text-lg font-semibold text-ink">
              {t(`${prefix}.successTitle`)}
            </h2>
            <p className="mt-2 text-sm text-ink/70">{t(`${prefix}.successBody`, { reference: sent.reference })}</p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Link
                href="/account/requests"
                onClick={onClose}
                className="flex-1 rounded-DEFAULT bg-brand px-4 py-2 text-center text-sm font-medium text-white hover:bg-brand-dark"
              >
                {t('care.viewRequests')}
              </Link>
              <Button variant="secondary" className="flex-1" onClick={onClose}>
                {t('care.dialog.close')}
              </Button>
            </div>
          </div>
        ) : (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!send.isPending && remaining >= 0) submit();
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id="contact-dialog-title" className="text-lg font-semibold text-ink">
                {t(`${prefix}.title`)}
              </h2>
              <button type="button" onClick={onClose} aria-label={t('care.dialog.close')} className="rounded p-1 text-ink/50 hover:bg-paper hover:text-ink">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <p className="mt-2 text-sm text-ink/70">{t(`${prefix}.intro`)}</p>

            {findForMe && (
              <div className="mt-5 space-y-4">
                <div>
                  <Label htmlFor="find-care-type" required>
                    {t('normalSearch.careType')}
                  </Label>
                  <Select
                    id="find-care-type"
                    ref={careTypeField}
                    value={careType}
                    onChange={(e) => setCareType(e.target.value as CareType | '')}
                    aria-invalid={shown('careType') ? true : undefined}
                    aria-describedby={shown('careType') ? 'find-care-type-error' : undefined}
                  >
                    <option value="">{t('care.findDialog.choose')}</option>
                    {careTypeValues.map((type) => (
                      <option key={type} value={type}>
                        {t(`careTypes.${type}`)}
                      </option>
                    ))}
                  </Select>
                  {shown('careType') && (
                    <p id="find-care-type-error" role="alert" className="mt-1 text-xs text-danger">
                      {shown('careType')}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="find-district" required>
                      {t('normalSearch.district')}
                    </Label>
                    <Select
                      id="find-district"
                      value={districtId}
                      onChange={(e) => {
                        setDistrictId(e.target.value);
                        setCityId('');
                      }}
                      aria-invalid={shown('district') ? true : undefined}
                      aria-describedby={shown('district') ? 'find-district-error' : undefined}
                    >
                      <option value="">{t('care.findDialog.choose')}</option>
                      {districts.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </Select>
                    {shown('district') && (
                      <p id="find-district-error" role="alert" className="mt-1 text-xs text-danger">
                        {shown('district')}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="find-city">{t('normalSearch.city')}</Label>
                    <Select id="find-city" value={cityId} onChange={(e) => setCityId(e.target.value)} disabled={!districtId}>
                      <option value="">{t('normalSearch.anyCity')}</option>
                      {sortedCities.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.subName ? `${c.name} - ${c.subName}` : c.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                <div>
                  <Label htmlFor="find-start">{t('normalSearch.startDate')}</Label>
                  <Input id="find-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
              </div>
            )}

            <div className="mt-5">
              <Label htmlFor="contact-message">{t(`${prefix}.messageLabel`)}</Label>
              <Textarea
                id="contact-message"
                ref={firstField}
                rows={4}
                maxLength={CARE_REQUEST_MESSAGE_MAX}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t(`${prefix}.messagePlaceholder`)}
                aria-describedby="contact-message-count"
              />
              <p id="contact-message-count" className="mt-1 text-right text-xs text-ink/40">
                {t('care.dialog.charsLeft', { count: remaining })}
              </p>
            </div>

            {error && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {error}
              </p>
            )}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={onClose}>
                {t('care.dialog.cancel')}
              </Button>
              <Button type="submit" disabled={send.isPending}>
                {send.isPending ? t('care.dialog.sending') : t(`${prefix}.send`)}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
