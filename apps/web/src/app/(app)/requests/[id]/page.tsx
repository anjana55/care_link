'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { BellRing, CalendarPlus, ChevronLeft, ExternalLink, Phone } from 'lucide-react';
import { PUBLIC_CAREGIVER_STATUSES } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { ApiError } from '@/lib/api/client';
import {
  useAddCareRequestNote,
  useAssignableStaff,
  useAssignCareRequest,
  useCareRequest,
  useNotifyCareRequestCaregiver,
  useSetCareRequestCaregiver,
  useUpdateCareRequestStatus,
} from '@/lib/hooks/use-care-requests';
import { CaregiverPicker } from '@/components/requests/caregiver-picker';
import { CaregiverSuggestions } from '@/components/requests/caregiver-suggestions';
import { RelatedBookings } from '@/components/bookings/related-bookings';
import { Button } from '@/components/ui/button';
import { Label, Select } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { PhoneLink } from '@/components/clients/contact-links';
import { RequestStatusBadge } from '@/components/requests/request-status-badge';
import type { CareRequestCloseReason, CareRequestDetail, CareRequestEvent, CareRequestStatus } from '@/lib/api/types';

const CLOSE_REASONS: CareRequestCloseReason[] = [
  'PLACED',
  'CLIENT_NOT_PROCEEDING',
  'CLIENT_UNREACHABLE',
  'CAREGIVER_UNAVAILABLE',
  'CAREGIVER_DECLINED',
  'NOT_A_MATCH',
  'OTHER',
];

const textareaClass =
  'w-full rounded border border-border bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

/**
 * One request, laid out for the call: the client on the left, the caregiver on
 * the right, both with numbers to tap, and the actions and history below. Staff
 * see everything here - the client and caregiver never see each other's
 * details through the app; staff decide what to share on the phone.
 */
export default function RequestDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { data: request, isLoading, isError } = useCareRequest(id);

  useEffect(() => {
    if (authLoading) return;
    if (user && user.role !== 'ADMIN' && user.role !== 'STAFF') router.replace('/dashboard');
  }, [authLoading, user, router]);

  if (authLoading || isLoading) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;
  }
  if (isError || !request) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-ink/60">
        <span>{t('requests.notFound')}</span>
        <Link href="/requests" className="text-brand-dark hover:underline">
          {t('requests.back')}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link href="/requests" className="mb-4 inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
        <ChevronLeft size={16} />
        {t('requests.back')}
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 text-xl font-semibold tabular-nums text-ink">
            {request.reference}
            <RequestStatusBadge status={request.status} label={t(`requests.status.${request.status}`)} />
          </h1>
          <p className="mt-1 text-sm text-ink/60">
            {t('requests.detail.received', { date: new Date(request.createdAt).toLocaleString() })}
            {' · '}
            {t('requests.detail.updatesIn', { language: t(`requests.detail.language.${request.language}`) })}
            {request.source === 'PHONE' && (
              <span className="ml-2 inline-flex items-center gap-1 rounded bg-paper px-1.5 py-0.5 text-xs text-ink/70">
                <Phone size={12} aria-hidden />
                {request.createdBy ? t('requests.detail.takenByPhone', { name: request.createdBy.fullName }) : t('requests.source.PHONE')}
              </span>
            )}
          </p>
        </div>
        <AssignControl request={request} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ClientPanel request={request} />
        <CaregiverPanel request={request} />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{request.source === 'PHONE' ? t('requests.detail.phoneMessage') : t('requests.detail.message')}</CardTitle>
        </CardHeader>
        <CardContent>
          {(request.careType || request.requestDistrict || request.desiredStartDate) && (
            <dl className="mb-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-ink/50">{t('requests.detail.careType')}</dt>
                <dd className="font-medium text-ink">{request.careType ? t(`careTypes.${request.careType}`) : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink/50">{t('requests.detail.careWhere')}</dt>
                <dd className="text-ink">{[request.requestCity, request.requestDistrict].filter(Boolean).join(', ') || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink/50">{t('requests.detail.careFrom')}</dt>
                <dd className="text-ink">{request.desiredStartDate ?? '—'}</dd>
              </div>
            </dl>
          )}
          {request.message ? (
            <p className="whitespace-pre-wrap text-sm text-ink">{request.message}</p>
          ) : (
            <p className="text-sm text-ink/50">{t('requests.detail.noMessage')}</p>
          )}
        </CardContent>
      </Card>

      {/* Matching: while the request is open and the caregiver can still change. */}
      {request.canChangeCaregiver && <CaregiverSuggestions request={request} />}

      {/* Bookings: once an introduction is made (or while staff are arranging
          it), the next step is to book the caregiver's shifts. */}
      {(request.status === 'INTRODUCED' || request.status === 'IN_PROGRESS' || request.status === 'CLOSED') && (
        <div className="mt-4 space-y-3">
          {request.caregiver && (request.status === 'INTRODUCED' || request.status === 'IN_PROGRESS') && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand/30 bg-brand-light px-4 py-3">
              <p className="text-sm text-brand-dark">{t('bookings.fromRequest.hint')}</p>
              <Link
                href={`/bookings/new?requestId=${request.id}`}
                className="inline-flex h-9 items-center gap-2 rounded bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark"
              >
                <CalendarPlus size={16} aria-hidden />
                {t('bookings.fromRequest.create')}
              </Link>
            </div>
          )}
          <RelatedBookings careRequestId={request.id} />
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <StatusActions request={request} />
        <History request={request} />
      </div>
    </div>
  );
}

function AssignControl({ request }: { request: CareRequestDetail }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: staff } = useAssignableStaff();
  const assign = useAssignCareRequest(request.id);
  const mine = request.assignedTo?.id === user?.userId;

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <span className="text-xs text-ink/50">{t('requests.detail.handledBy')}</span>
      <div className="flex items-center gap-2">
        <Select
          className="w-52"
          value={request.assignedTo?.id ?? ''}
          disabled={assign.isPending}
          aria-label={t('requests.detail.handledBy')}
          onChange={(e) => assign.mutate(e.target.value || null)}
        >
          <option value="">{t('requests.detail.nobody')}</option>
          {(staff ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.fullName}
            </option>
          ))}
          {/* Keep a since-deactivated assignee visible rather than silently showing "nobody". */}
          {request.assignedTo && !(staff ?? []).some((s) => s.id === request.assignedTo!.id) && (
            <option value={request.assignedTo.id}>{request.assignedTo.fullName}</option>
          )}
        </Select>
        {!mine && user && (
          <Button variant="secondary" size="sm" disabled={assign.isPending} onClick={() => assign.mutate(user.userId)}>
            {t('requests.detail.assignToMe')}
          </Button>
        )}
      </div>
      {assign.isError && (
        <p className="text-xs text-danger">{assign.error instanceof ApiError ? assign.error.message : t('requests.detail.saveFailed')}</p>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2 last:border-0">
      <span className="shrink-0 text-sm text-ink/60">{label}</span>
      <span className="min-w-0 text-right text-sm text-ink">{children}</span>
    </div>
  );
}

function ClientPanel({ request }: { request: CareRequestDetail }) {
  const { t } = useTranslation();
  const c = request.client;
  const opt = (group: string, value: string | null) => (value ? t(`clients.options.${group}.${value}`) : '—');
  const prefersWhatsapp = c.preferredContactMethod === 'WHATSAPP';

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle>{t('requests.detail.client')}</CardTitle>
        <Link href={`/clients/${c.id}`} className="inline-flex items-center gap-1 text-xs text-brand-dark hover:underline">
          {t('requests.detail.openClient')}
          <ExternalLink size={12} />
        </Link>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold text-ink">{c.fullName}</span>
          <StatusBadge status={c.status} label={t(`clients.status.${c.status}`)} />
        </div>
        {c.status === 'PENDING_REVIEW' && <p className="mb-3 rounded bg-accent-light px-3 py-2 text-xs text-accent">{t('requests.detail.clientPending')}</p>}
        <Row label={t('requests.detail.phone')}>{c.phone ? <PhoneLink phone={c.phone} whatsapp={prefersWhatsapp} /> : '—'}</Row>
        {c.accountPhone && c.accountPhone !== c.phone && (
          <Row label={t('requests.detail.whatsapp')}>
            <PhoneLink phone={c.accountPhone} whatsapp />
          </Row>
        )}
        {c.alternatePhone && (
          <Row label={t('requests.detail.alternatePhone')}>
            <PhoneLink phone={c.alternatePhone} />
          </Row>
        )}
        <Row label={t('requests.detail.email')}>
          {c.email ? (
            <a href={`mailto:${c.email}`} className="text-brand-dark hover:underline">
              {c.email}
            </a>
          ) : (
            <span className="text-ink/50">{t('requests.detail.noEmail')}</span>
          )}
        </Row>
        <Row label={t('requests.detail.preferredContact')}>
          {opt('contactMethod', c.preferredContactMethod)}
          {c.preferredContactTime && <span className="text-ink/50"> · {opt('contactTime', c.preferredContactTime)}</span>}
        </Row>
        {c.registrantType === 'GUARDIAN' && (
          <Row label={t('requests.detail.careFor')}>
            {[c.recipientName, c.recipientRelationship && opt('relationship', c.recipientRelationship), c.recipientAge && t('requests.detail.age', { age: c.recipientAge })]
              .filter(Boolean)
              .join(' · ') || '—'}
          </Row>
        )}
        <Row label={t('requests.detail.location')}>{[c.city, c.district].filter(Boolean).join(', ') || '—'}</Row>
        {c.careAddress && <Row label={t('requests.detail.careAddress')}>{c.careAddress}</Row>}
        <Row label={t('requests.detail.schedule')}>
          {opt('careSchedule', c.careSchedule)}
          {c.careStart && <span className="text-ink/50"> · {opt('careStart', c.careStart)}</span>}
        </Row>
        <Row label={t('requests.detail.genderPreference')}>{opt('caregiverGender', c.preferredCaregiverGender)}</Row>
        {c.careNeeds && (
          <div className="pt-2">
            <p className="text-sm text-ink/60">{t('requests.detail.careNeeds')}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{c.careNeeds}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The caregiver half of the request. While the request is open staff can
 * attach one (a phone request may start without), swap to another, or detach.
 */
function CaregiverPanel({ request }: { request: CareRequestDetail }) {
  const { t } = useTranslation();
  const setCaregiver = useSetCareRequestCaregiver(request.id);
  const [picking, setPicking] = useState(false);
  const g = request.caregiver;

  const pick = (id: string | null) => setCaregiver.mutate(id, { onSuccess: () => setPicking(false) });
  const error = setCaregiver.isError ? (setCaregiver.error instanceof ApiError ? setCaregiver.error.message : t('requests.detail.saveFailed')) : null;

  if (!g || picking) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('requests.detail.caregiver')}</CardTitle>
        </CardHeader>
        <CardContent>
          {!g && <p className="mb-3 rounded bg-accent-light px-3 py-2 text-sm text-accent">{t('requests.detail.noCaregiver')}</p>}
          {request.canChangeCaregiver ? (
            <>
              <p className="mb-2 text-sm text-ink/60">{t('requests.detail.pickCaregiverHint')}</p>
              <CaregiverPicker autoFocus={picking} onPick={(c) => pick(c.id)} onCancel={g ? () => setPicking(false) : undefined} />
            </>
          ) : (
            <p className="text-sm text-ink/60">{t('requests.detail.caregiverLocked')}</p>
          )}
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle>{t('requests.detail.caregiver')}</CardTitle>
        {!g.deleted && (
          <Link href={`/caregivers/${g.id}`} className="inline-flex items-center gap-1 text-xs text-brand-dark hover:underline">
            {t('requests.detail.openCaregiver')}
            <ExternalLink size={12} />
          </Link>
        )}
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold text-ink">{g.fullName}</span>
          <StatusBadge status={g.status} label={t(`caregivers.status.${g.status}`)} />
        </div>
        {g.deleted && <p className="mb-3 rounded bg-danger-light px-3 py-2 text-xs text-danger">{t('requests.detail.caregiverRemovedNote')}</p>}
        {!g.deleted && !(PUBLIC_CAREGIVER_STATUSES as readonly string[]).includes(g.status) && (
          <p className="mb-3 rounded bg-accent-light px-3 py-2 text-xs text-accent">{t('requests.detail.caregiverNotActive')}</p>
        )}
        <Row label={t('requests.detail.registration')}>
          <span className="tabular-nums">{g.registrationNumber}</span>
        </Row>
        <Row label={t('requests.detail.phone')}>{g.primaryPhone ? <PhoneLink phone={g.primaryPhone} whatsapp /> : '—'}</Row>
        {g.secondaryPhone && (
          <Row label={t('requests.detail.alternatePhone')}>
            <PhoneLink phone={g.secondaryPhone} />
          </Row>
        )}
        <Row label={t('requests.detail.email')}>
          {g.email ? (
            <a href={`mailto:${g.email}`} className="text-brand-dark hover:underline">
              {g.email}
            </a>
          ) : (
            <span className="text-ink/50">{t('requests.detail.noEmail')}</span>
          )}
        </Row>
        <Row label={t('requests.detail.location')}>{[g.city, g.district].filter(Boolean).join(', ') || '—'}</Row>
        <NotifyCaregiverRow request={request} />
        {request.canChangeCaregiver && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
              {t('requests.detail.changeCaregiver')}
            </Button>
            <Button size="sm" variant="secondary" disabled={setCaregiver.isPending} onClick={() => pick(null)}>
              {t('requests.detail.removeCaregiver')}
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Whether the caregiver has been told about this request. Caregivers set to
 * auto-notify hear straight away; for the rest staff press "Notify caregiver"
 * when they are ready (and can send it again).
 */
function NotifyCaregiverRow({ request }: { request: CareRequestDetail }) {
  const { t } = useTranslation();
  const notify = useNotifyCareRequestCaregiver(request.id);
  const g = request.caregiver;
  if (!g) return null;
  const error = notify.isError ? (notify.error instanceof ApiError ? notify.error.message : t('requests.detail.saveFailed')) : null;
  return (
    <div className="mt-3 rounded border border-border bg-paper px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm text-ink">
          <BellRing size={14} className="text-brand" aria-hidden />
          {request.caregiverNotifiedAt
            ? t('requests.detail.notifiedAt', { when: new Date(request.caregiverNotifiedAt).toLocaleString() })
            : g.autoNotifyRequests
              ? t('requests.detail.notNotifiedAuto')
              : t('requests.detail.notNotified')}
        </p>
        {request.canNotifyCaregiver && (
          <Button size="sm" variant={request.caregiverNotifiedAt ? 'secondary' : 'primary'} disabled={notify.isPending} onClick={() => notify.mutate(undefined)}>
            {notify.isPending
              ? t('requests.detail.notifying')
              : request.caregiverNotifiedAt
                ? t('requests.detail.notifyAgain')
                : t('requests.detail.notifyCaregiver')}
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs text-ink/50">
        {g.preferredContactMethod === 'PHONE_CALL'
          ? t('requests.detail.caregiverPrefersCall', { phone: g.primaryPhone ?? '—' })
          : g.autoNotifyRequests
            ? t('requests.detail.autoNotifyOn')
            : t('requests.detail.autoNotifyOff')}
      </p>
      {notify.isSuccess && (
        <p role="status" className="mt-1 text-xs text-brand-dark">
          {notify.data.notifiedBy === 'WHATSAPP' ? t('requests.detail.notifiedByWhatsapp') : t('requests.detail.notifiedByEmail')}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function StatusActions({ request }: { request: CareRequestDetail }) {
  const { t } = useTranslation();
  const update = useUpdateCareRequestStatus(request.id);
  const [target, setTarget] = useState<CareRequestStatus | null>(null);
  const [closeReason, setCloseReason] = useState<CareRequestCloseReason | ''>('');
  const [note, setNote] = useState('');

  // A move that just succeeded changes which moves exist; start over.
  useEffect(() => {
    setTarget(null);
    setCloseReason('');
    setNote('');
  }, [request.status]);

  const moveLabel = (to: CareRequestStatus) =>
    to === 'IN_PROGRESS' && request.status === 'NEW'
      ? t('requests.detail.move.PICK_UP')
      : to === 'IN_PROGRESS'
        ? t('requests.detail.move.REOPEN')
        : t(`requests.detail.move.${to}`);

  const submit = () => {
    if (!target) return;
    update.mutate({ status: target, ...(target === 'CLOSED' && closeReason ? { closeReason } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('requests.detail.actions')}</CardTitle>
      </CardHeader>
      <CardContent>
        {request.allowedNextStatuses.length === 0 ? (
          <p className="text-sm text-ink/60">{t('requests.detail.noMoves')}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {request.allowedNextStatuses.map((to) => (
                <Button
                  key={to}
                  variant={target === to ? 'primary' : 'secondary'}
                  size="sm"
                  aria-pressed={target === to}
                  onClick={() => setTarget(target === to ? null : to)}
                >
                  {moveLabel(to)}
                </Button>
              ))}
            </div>

            {target && (
              <div className="mt-4 space-y-3 rounded border border-border bg-paper p-3">
                {target === 'CLOSED' && (
                  <div>
                    <Label htmlFor="closeReason" required>
                      {t('requests.detail.closeReasonLabel')}
                    </Label>
                    <Select id="closeReason" value={closeReason} onChange={(e) => setCloseReason(e.target.value as CareRequestCloseReason)}>
                      <option value="">{t('requests.detail.chooseReason')}</option>
                      {CLOSE_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {t(`requests.closeReason.${r}`)}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                <div>
                  <Label htmlFor="moveNote">{t('requests.detail.noteOptional')}</Label>
                  <textarea id="moveNote" rows={2} maxLength={2000} className={textareaClass} value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                <p className="text-xs text-ink/50">{t(`requests.detail.notifyHint.${target}`)}</p>
                <div className="flex gap-2">
                  <Button size="sm" disabled={update.isPending || (target === 'CLOSED' && !closeReason)} onClick={submit}>
                    {update.isPending ? t('common.loading') : t('requests.detail.confirmMove', { action: moveLabel(target) })}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setTarget(null)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            )}
            {update.isError && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {update.error instanceof ApiError ? update.error.message : t('requests.detail.saveFailed')}
              </p>
            )}
          </>
        )}
        {request.closeReason && request.status === 'CLOSED' && (
          <p className="mt-4 text-sm text-ink/70">
            {t('requests.detail.closedBecause', { reason: t(`requests.closeReason.${request.closeReason}`) })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function History({ request }: { request: CareRequestDetail }) {
  const { t } = useTranslation();
  const addNote = useAddCareRequestNote(request.id);
  const [note, setNote] = useState('');

  const describe = (e: CareRequestEvent) => {
    switch (e.type) {
      case 'CREATED':
        return request.source === 'PHONE' ? t('requests.detail.event.CREATED_PHONE') : t('requests.detail.event.CREATED');
      case 'CANCELLED':
        return t('requests.detail.event.CANCELLED');
      case 'STATUS_CHANGED':
        return t('requests.detail.event.STATUS_CHANGED', {
          from: e.fromStatus ? t(`requests.status.${e.fromStatus}`) : '—',
          to: e.toStatus ? t(`requests.status.${e.toStatus}`) : '—',
        });
      case 'ASSIGNED':
        return e.note ? t('requests.detail.event.ASSIGNED', { name: e.note }) : t('requests.detail.event.UNASSIGNED');
      case 'CAREGIVER_CHANGED':
        return e.note ? t('requests.detail.event.CAREGIVER_CHANGED', { name: e.note }) : t('requests.detail.event.CAREGIVER_REMOVED');
      case 'NOTE':
        return t('requests.detail.event.NOTE');
      case 'CAREGIVER_NOTIFIED':
        return e.actor ? t('requests.detail.event.CAREGIVER_NOTIFIED') : t('requests.detail.event.CAREGIVER_NOTIFIED_AUTO');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('requests.detail.history')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) addNote.mutate(note.trim(), { onSuccess: () => setNote('') });
          }}
          className="mb-4"
        >
          <Label htmlFor="newNote">{t('requests.detail.addNote')}</Label>
          <textarea
            id="newNote"
            rows={2}
            maxLength={2000}
            className={textareaClass}
            placeholder={t('requests.detail.notePlaceholder')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="mt-2 flex items-center gap-3">
            <Button type="submit" size="sm" variant="secondary" disabled={addNote.isPending || !note.trim()}>
              {t('requests.detail.addNote')}
            </Button>
            {addNote.isError && (
              <span className="text-xs text-danger">{addNote.error instanceof ApiError ? addNote.error.message : t('requests.detail.saveFailed')}</span>
            )}
          </div>
        </form>

        <ol className="space-y-3">
          {[...request.events].reverse().map((e) => (
            <li key={e.id} className="border-l-2 border-border pl-3">
              <p className="text-sm text-ink">{describe(e)}</p>
              {e.closeReason && <p className="mt-0.5 text-sm text-ink/70">{t(`requests.closeReason.${e.closeReason}`)}</p>}
              {/* An ASSIGNED event's note is the assignee's name, already in the line above. */}
              {e.note && e.type !== 'ASSIGNED' && e.type !== 'CAREGIVER_CHANGED' && <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink/70">{e.note}</p>}
              <p className="mt-0.5 text-xs text-ink/50">
                {new Date(e.createdAt).toLocaleString()}
                {e.actor && ` · ${t('requests.detail.by', { name: e.actor.fullName })}`}
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
