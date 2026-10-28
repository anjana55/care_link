'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft, ExternalLink, Mail, Pencil, Phone, UserRound } from 'lucide-react';
import { employerEnquiryStatusValues, type EmployerEnquiryStatus } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { useEmployerEnquiry, useUpdateEmployerEnquiry } from '@/lib/hooks/use-international';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EnquiryStatusBadge, countryName } from '@/components/international/shared';
import { CandidatesCard } from '@/components/international/candidates-card';
import { EnquiryVacanciesCard } from '@/components/international/enquiry-vacancies-card';
import { EditEnquiryForm } from '@/components/international/edit-enquiry-form';
import { DeleteRecordButton } from '@/components/overseas-admin/delete-record-button';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-ink/50">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

/**
 * One overseas employer enquiry. Staff contact the employer (email and phone
 * are here), shortlist and introduce caregivers, and - when a caregiver
 * starts work - mark it Placed and record the placement fee agreed. Admins
 * can also correct what the employer sent, and link it to their account.
 */
export default function EmployerEnquiryPage() {
  const { t, locale } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const router = useRouter();
  const { data: enquiry, isLoading, isError } = useEmployerEnquiry(id);
  const update = useUpdateEmployerEnquiry(id);
  const [status, setStatus] = useState<EmployerEnquiryStatus>('NEW');
  const [note, setNote] = useState('');
  const [fee, setFee] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (user && user.role !== 'ADMIN' && user.role !== 'STAFF') router.replace('/dashboard');
  }, [loading, user, router]);

  useEffect(() => {
    if (!enquiry) return;
    setStatus(enquiry.status);
    setNote(enquiry.staffNote ?? '');
    setFee(enquiry.placementFeeAmount === null ? '' : String(enquiry.placementFeeAmount));
    setCurrency(enquiry.placementFeeCurrency ?? 'USD');
  }, [enquiry]);

  if (isLoading || loading) return <p className="py-10 text-center text-sm text-ink/50">{t('common.loading')}</p>;
  if (isError || !enquiry) return <p className="py-10 text-center text-sm text-danger">{t('international.detail.notFound')}</p>;

  const save = () => {
    setSaved(false);
    update.mutate(
      {
        status,
        staffNote: note.trim() || null,
        ...(status === 'PLACED' ? { placementFeeAmount: fee === '' ? null : Number(fee), placementFeeCurrency: fee === '' ? null : currency.toUpperCase() } : {}),
      },
      { onSuccess: () => setSaved(true) },
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/international" className="inline-flex items-center gap-1 text-sm text-ink/60 hover:text-brand-dark">
          <ChevronLeft size={16} aria-hidden />
          {t('international.detail.back')}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-ink">
            {enquiry.reference} · {enquiry.organisationName}
          </h1>
          <EnquiryStatusBadge status={enquiry.status} />
          {user?.role === 'ADMIN' && !editing && (
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                <Pencil size={14} aria-hidden className="mr-1.5" />
                {t('international.edit.button')}
              </Button>
              <DeleteRecordButton
                path={`/international/enquiries/${enquiry.id}`}
                title={t('overseasAdmin.deleteEnquiry.title', { reference: enquiry.reference })}
                body={t('overseasAdmin.deleteEnquiry.body')}
                onDeleted={() => router.push('/international')}
              />
            </div>
          )}
        </div>
        <p className="mt-1 text-sm text-ink/60">{t('international.detail.received', { date: new Date(enquiry.createdAt).toLocaleString() })}</p>
      </div>

      {editing ? (
        <EditEnquiryForm enquiry={enquiry} onDone={() => setEditing(false)} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('international.detail.employer')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                <Row label={t('international.detail.type')}>{t(`international.employerTypes.${enquiry.organisationType}`)}</Row>
                <Row label={t('international.enquiries.country')}>{countryName(enquiry.country, locale)}</Row>
                <Row label={t('international.detail.contact')}>{enquiry.contactName}</Row>
                <Row label={t('international.detail.email')}>
                  <a href={`mailto:${enquiry.email}?subject=${encodeURIComponent(enquiry.reference)}`} className="inline-flex items-center gap-1 text-brand-dark hover:underline">
                    <Mail size={14} aria-hidden />
                    {enquiry.email}
                  </a>
                </Row>
                {enquiry.phone && (
                  <Row label={t('international.detail.phone')}>
                    <a href={`tel:${enquiry.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 text-brand-dark hover:underline">
                      <Phone size={14} aria-hidden />
                      {enquiry.phone}
                    </a>
                  </Row>
                )}
                {enquiry.website && (
                  <Row label={t('international.detail.website')}>
                    <a href={/^https?:\/\//.test(enquiry.website) ? enquiry.website : `https://${enquiry.website}`} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-brand-dark hover:underline">
                      <ExternalLink size={14} aria-hidden />
                      {enquiry.website}
                    </a>
                  </Row>
                )}
                <Row label={t('international.detail.language')}>{enquiry.language.toUpperCase()}</Row>
                <Row label={t('international.detail.account')}>
                  {enquiry.employer ? (
                    <span>
                      {enquiry.employer.organisationName} · {t(`international.employers.status.${enquiry.employer.status}`)}
                    </span>
                  ) : (
                    <span className="text-ink/50">{t('international.detail.noAccount')}</span>
                  )}
                </Row>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('international.detail.needs')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                <Row label={t('international.enquiries.roles')}>{enquiry.rolesCount}</Row>
                <Row label={t('international.detail.settings')}>{enquiry.careSettings.map((c) => t(`careTypes.${c}`)).join(', ')}</Row>
                {enquiry.languages && <Row label={t('international.detail.languages')}>{enquiry.languages}</Row>}
                {enquiry.startTimeframe && <Row label={t('international.detail.start')}>{enquiry.startTimeframe}</Row>}
                <Row label={t('international.detail.visa')}>{t(`international.visa.${enquiry.visaSponsorship}`)}</Row>
              </dl>
              {enquiry.message && <p className="mt-3 whitespace-pre-line rounded bg-paper p-3 text-sm text-ink/80">{enquiry.message}</p>}
              {enquiry.caregiver && (
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded border border-accent/30 bg-accent-light/40 p-3 text-sm">
                  <UserRound size={16} className="text-accent" aria-hidden />
                  <span>{t('international.detail.askedAbout')}</span>
                  <Link href={`/caregivers/${enquiry.caregiver.id}`} className="font-medium text-brand-dark hover:underline">
                    {enquiry.caregiver.fullName} ({enquiry.caregiver.registrationNumber})
                  </Link>
                  {enquiry.caregiver.talentSlug && (
                    <a href={`/talent/${enquiry.caregiver.talentSlug}`} target="_blank" rel="noreferrer" className="text-xs text-ink/60 hover:underline">
                      {t('international.detail.sharedProfile')}
                    </a>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <CandidatesCard enquiry={enquiry} />
      <EnquiryVacanciesCard enquiry={enquiry} />

      <Card>
        <CardHeader>
          <CardTitle>{t('international.detail.handling')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="enq-status">{t('international.enquiries.status')}</Label>
              <Select id="enq-status" value={status} onChange={(e) => setStatus(e.target.value as EmployerEnquiryStatus)}>
                {employerEnquiryStatusValues.map((s) => (
                  <option key={s} value={s}>
                    {t(`international.status.${s}`)}
                  </option>
                ))}
              </Select>
            </div>
            {status === 'PLACED' && (
              <>
                <div>
                  <Label htmlFor="enq-fee">{t('international.detail.fee')}</Label>
                  <Input id="enq-fee" type="number" min={0} step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="enq-currency">{t('international.detail.currency')}</Label>
                  <Input id="enq-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} maxLength={3} />
                </div>
              </>
            )}
          </div>
          {status === 'PLACED' && <p className="text-xs text-ink/50">{t('international.detail.feeHint')}</p>}
          <div>
            <Label htmlFor="enq-note">{t('international.detail.note')}</Label>
            <Textarea id="enq-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} placeholder={t('international.detail.notePlaceholder')} />
          </div>
          {update.isError && <p className="text-sm text-danger">{update.error instanceof Error ? update.error.message : t('common.actionFailed')}</p>}
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={update.isPending}>
              {t('common.save')}
            </Button>
            {saved && <span className="text-sm text-brand-dark">{t('international.detail.saved')}</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
