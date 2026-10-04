'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { ApiError } from '@/lib/api/client';
import {
  useClient,
  useSetClientActive,
  useUpdateClient,
  useUpdateClientStatus,
  type ClientUpdateValues,
} from '@/lib/hooks/use-clients';
import { useLocationTree } from '@/lib/hooks/use-caregivers';
import { Button } from '@/components/ui/button';
import { FieldError, RequiredLegend, Select } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ClientProfileFields } from '@/components/clients/client-profile-fields';
import { makeClientProfileSchema, UNSET_ID } from '@/lib/schemas/client-profile';
import { allowedNextClientStatuses } from '@/lib/client-status';
import type { ClientStatus } from '@/lib/api/types';

export default function ClientDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { data: client, isLoading, isError } = useClient(id);

  const statusMutation = useUpdateClientStatus(id);
  const activeMutation = useSetClientActive(id);
  const updateMutation = useUpdateClient(id);
  const { data: locationTree, isError: locationsUnavailable } = useLocationTree();

  const [isEditing, setIsEditing] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const isAdmin = user?.role === 'ADMIN';
  const canEdit = isAdmin || user?.role === 'STAFF';

  const schema = makeClientProfileSchema(t);
  const form = useForm<any>({ resolver: zodResolver(schema as any) });

  // ?edit=1 deep links straight into edit mode, so a staff member can send a
  // colleague to the exact correction rather than to the page it lives on.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('edit') === '1') setIsEditing(true);
  }, []);

  // Hydrate from the DETAIL endpoint, never from a list row: findAll masks the
  // phone, and a masked value submitted back would be written to the database
  // verbatim. useClient(id) hits findOne, which is unmasked.
  useEffect(() => {
    if (isEditing && client) {
      form.reset({
        fullName: client.fullName ?? '',
        email: client.email ?? '',
        phone: client.phone ?? '',
        permanentAddress: client.permanentAddress ?? '',
        nic: client.nic ?? '',
        dateOfBirth: client.dateOfBirth ? client.dateOfBirth.slice(0, 10) : '',
        gender: client.gender ?? '',
        districtId: client.districtId ?? UNSET_ID,
        cityId: client.cityId ?? UNSET_ID,
        notes: client.notes ?? '',
      });
      setServerError(null);
    }
  }, [isEditing, client, form]);

  function fmt(value: string | null, fallback: string) {
    return value ? new Date(value).toLocaleString() : fallback;
  }

  function onSave(data: any) {
    setServerError(null);
    // Omit rather than send blank values. The API rejects an empty date string
    // outright, and treats a blank phone as "not submitted" - clearing the
    // number on a WhatsApp-only client would leave them unable to sign in with
    // no endpoint that could undo it. Location is likewise all-or-nothing: a
    // request naming neither id is a no-op, and a mismatched pair is a 400.
    const payload: ClientUpdateValues = { fullName: data.fullName };

    const trimmed = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    for (const key of ['email', 'phone', 'permanentAddress', 'nic', 'notes'] as const) {
      const value = trimmed(data[key]);
      if (value) payload[key] = value;
    }
    if (data.dateOfBirth) payload.dateOfBirth = data.dateOfBirth;
    if (data.gender) payload.gender = data.gender;
    if (data.districtId && data.cityId) {
      payload.districtId = Number(data.districtId);
      payload.cityId = Number(data.cityId);
    }

    updateMutation.mutate(payload, {
      onSuccess: () => setIsEditing(false),
      onError: (err: unknown) =>
        setServerError(err instanceof ApiError ? err.message : t('clients.validation.saveFailed')),
    });
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">
        <span>{t('common.loading')}</span>
      </div>
    );
  }

  if (isError || !client) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-ink/60">
        <span>{t('clients.empty')}</span>
        <Link href="/clients" className="text-brand-dark hover:underline">
          {t('clients.back')}
        </Link>
      </div>
    );
  }

  const nextStatuses = allowedNextClientStatuses(client.status);

  return (
    <div>
      <Link
        href="/clients"
        className="mb-4 inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink"
      >
        <ChevronLeft size={16} />
        {t('clients.back')}
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">{client.fullName}</h1>
        {isEditing ? (
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              disabled={updateMutation.isPending}
              onClick={form.handleSubmit(onSave)}
            >
              {t('common.save')}
            </Button>
            <Button variant="secondary" onClick={() => setIsEditing(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <StatusBadge status={client.status} label={t(`clients.status.${client.status}`)} />
            {canEdit && (
              <Button variant="secondary" size="sm" onClick={() => setIsEditing(true)}>
                {t('clients.actions.edit')}
              </Button>
            )}
          </div>
        )}
      </div>

      {isEditing ? (
        <form onSubmit={form.handleSubmit(onSave)} className="space-y-5">
          <RequiredLegend label={t('common.requiredField')} />
          <ClientProfileFields
            register={form.register}
            control={form.control}
            setValue={form.setValue}
            errors={form.formState.errors}
            locationTree={locationTree ?? []}
            locationsUnavailable={locationsUnavailable}
            serverError={serverError}
          />
          <div className="flex justify-end border-t border-border pt-4">
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? t('common.loading') : t('common.save')}
            </Button>
          </div>
        </form>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title={t('clients.detail.contact')}>
            <Row label={t('clients.table.name')} value={client.fullName} />
            <Row label={t('clients.detail.phone')} value={client.phone || '—'} />
            <Row
              label={t('clients.detail.email')}
              value={client.email || t('clients.detail.noEmail')}
            />
          </Panel>

          <Panel title={t('clients.detail.profile')}>
            <Row label={t('personalInfo.fields.permanentAddress')} value={client.permanentAddress || '—'} />
            <Row
              label={t('personalInfo.fields.dateOfBirth')}
              value={client.dateOfBirth ? client.dateOfBirth.slice(0, 10) : '—'}
            />
            <Row
              label={t('personalInfo.fields.gender')}
              value={client.gender ? t(`personalInfo.options.gender.${client.gender}`) : '—'}
            />
            <Row label={t('personalInfo.fields.nic')} value={client.nic || '—'} />
            <Row
              label={t('personalInfo.fields.district')}
              value={
                client.district && client.city
                  ? `${client.district} / ${client.city}`
                  : client.district || client.city || '—'
              }
            />
            <Row label={t('personalInfo.fields.postalCode')} value={client.postalCode || '—'} />
          </Panel>

          <Panel title={t('clients.detail.account')}>
            <Row
              label={t('clients.detail.isActive')}
              value={client.isActive ? t('clients.account.active') : t('clients.account.inactive')}
            />
            <Row
              label={t('clients.detail.whatsappNumber')}
              value={client.accountPhone || t('clients.detail.notLinked')}
            />
            <Row
              label={t('clients.detail.emailVerified')}
              value={client.emailVerifiedAt ? fmt(client.emailVerifiedAt, '') : t('clients.detail.emailUnverified')}
            />
            <Row
              label={t('clients.detail.lastLogin')}
              value={fmt(client.lastLoginAt, t('clients.never'))}
            />
          </Panel>

          <Panel title={t('clients.detail.registration')}>
            <Row label={t('clients.detail.registered')} value={fmt(client.createdAt, '')} />
            <Row label={t('clients.detail.updated')} value={fmt(client.updatedAt, '—')} />
            <Row
              label={t('clients.detail.consent')}
              value={fmt(client.consentAcceptedAt, t('clients.detail.notRecorded'))}
            />
            {client.notes && <Row label={t('clients.form.notes')} value={client.notes} />}
          </Panel>

          {canEdit && (
            <Panel title={t('clients.changeStatus')}>
              <div className="flex flex-col gap-3">
                <Select
                  value={client.status}
                  disabled={statusMutation.isPending}
                  onChange={(e) => statusMutation.mutate(e.target.value as ClientStatus)}
                >
                  {/* Only the transitions the API will accept. Offering all
                      four meant every illegal pick was a 400 with nothing on
                      screen to explain it. */}
                  {nextStatuses.length === 0 ? (
                    <option value={client.status}>{t(`clients.status.${client.status}`)}</option>
                  ) : (
                    nextStatuses.map((s) => (
                      <option key={s} value={s}>
                        {t(`clients.status.${s}`)}
                      </option>
                    ))
                  )}
                </Select>

                {/* The transition rules are enforced server-side, so a rejection
                    still has to be visible rather than silently reverting. */}
                <FieldError
                  message={
                    statusMutation.isError
                      ? statusMutation.error instanceof ApiError
                        ? statusMutation.error.message
                        : t('clients.validation.saveFailed')
                      : undefined
                  }
                />

                {isAdmin && (
                  <Button
                    variant="secondary"
                    disabled={activeMutation.isPending}
                    onClick={() => activeMutation.mutate(!client.isActive)}
                  >
                    {client.isActive
                      ? t('clients.actions.deactivate')
                      : t('clients.actions.activate')}
                  </Button>
                )}
              </div>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2 last:border-0">
      <span className="text-sm text-ink/60">{label}</span>
      <span className="text-right text-sm text-ink">{value}</span>
    </div>
  );
}