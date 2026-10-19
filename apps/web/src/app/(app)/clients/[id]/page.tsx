'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { api, ApiError } from '@/lib/api/client';
import { useClient, useDeleteClient, useUpdateClient, type ClientUpdateValues } from '@/lib/hooks/use-clients';
import { useLocationTree } from '@/lib/hooks/use-caregivers';
import { Button } from '@/components/ui/button';
import { RequiredLegend } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ClientProfileFields } from '@/components/clients/client-profile-fields';
import { ClientOverview } from '@/components/clients/client-overview';
import { ClientLifecyclePanels, ClientStatusMove } from '@/components/clients/client-lifecycle';
import { RelatedRequests } from '@/components/requests/related-requests';
import { RelatedBookings } from '@/components/bookings/related-bookings';
import { makeClientProfileSchema, UNSET_ID } from '@/lib/schemas/client-profile';

/**
 * A client's page, laid out like a caregiver's: name and status in the header
 * with the lifecycle "Move to…" control, Edit and Delete beside it; the record
 * in tabs below. The status control used to sit at the bottom of the page and
 * its dropdown could not select the first legal move (see StatusMoveSelect).
 */
export default function ClientDetailPage() {
  const { t, locale } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { data: client, isLoading, isError } = useClient(id);

  const updateMutation = useUpdateClient(id);
  const deleteMutation = useDeleteClient();
  const [isDeleteConfirm, setIsDeleteConfirm] = useState(false);
  const { data: locationTree, isError: locationsUnavailable } = useLocationTree();

  const [isEditing, setIsEditing] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const isAdmin = user?.role === 'ADMIN';
  const canEdit = isAdmin || user?.role === 'STAFF';

  // Same audit tab as a caregiver's: admin-only, matching @Roles on the
  // audit-logs endpoint. Status changes are recorded as UPDATE_CLIENT_STATUS.
  const { data: auditEntries } = useQuery({
    queryKey: ['audit', 'Patient', id],
    queryFn: () => api.get<{ id: string; action: string; createdAt: string }[]>(`/audit-logs?entityType=Patient&entityId=${id}`),
    enabled: Boolean(id) && isAdmin,
  });

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

  return (
    <div>
      <Link
        href="/clients"
        className="mb-4 inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink"
      >
        <ChevronLeft size={16} />
        {t('clients.back')}
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">{client.fullName}</h1>
          <p className="text-sm text-ink/50">
            {client.registrantType === 'GUARDIAN' && client.recipientName
              ? `${t('clients.forRecipient')} ${client.recipientName} · `
              : ''}
            {t('clients.detail.registered')} {new Date(client.createdAt).toLocaleDateString(locale)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isEditing ? (
            <>
              <Button variant="primary" disabled={updateMutation.isPending} onClick={form.handleSubmit(onSave)}>
                {t('common.save')}
              </Button>
              <Button variant="secondary" onClick={() => setIsEditing(false)}>
                {t('common.cancel')}
              </Button>
            </>
          ) : (
            <>
              <StatusBadge status={client.status} label={t(`clients.status.${client.status}`)} />
              {canEdit && <ClientStatusMove client={client} />}
              {canEdit && (
                <Link
                  href={`/requests/new?patientId=${client.id}`}
                  className="inline-flex h-10 items-center rounded border border-border bg-white px-4 text-sm font-medium text-ink hover:bg-paper"
                >
                  {t('requests.newRequestForClient')}
                </Link>
              )}
              {canEdit && (
                <Button variant="secondary" onClick={() => setIsEditing(true)}>
                  {t('common.edit')}
                </Button>
              )}
              {/* Deleting a client account is admin-only, matching the API. */}
              {isAdmin && (
                <Button
                  variant="danger"
                  onClick={() => {
                    deleteMutation.reset();
                    setIsDeleteConfirm(true);
                  }}
                >
                  {t('common.delete')}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('caregivers.profile.tabs.overview')}</TabsTrigger>
          {canEdit && <TabsTrigger value="lifecycle">{t('lifecycle.client.tab')}</TabsTrigger>}
          {canEdit && <TabsTrigger value="requests">{t('requests.related.title')}</TabsTrigger>}
          {isAdmin && <TabsTrigger value="audit">{t('caregivers.profile.tabs.audit')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview">
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
              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Button type="button" variant="secondary" onClick={() => setIsEditing(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? t('common.loading') : t('common.save')}
                </Button>
              </div>
            </form>
          ) : (
            <ClientOverview client={client} />
          )}
        </TabsContent>

        {canEdit && (
          <TabsContent value="lifecycle">
            <ClientLifecyclePanels client={client} isAdmin={isAdmin} />
          </TabsContent>
        )}

        {canEdit && (
          <TabsContent value="requests">
            <div className="space-y-4">
              <RelatedRequests patientId={client.id} />
              <RelatedBookings patientId={client.id} />
            </div>
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="audit">
            <Card>
              <CardContent className="divide-y divide-border py-5">
                {auditEntries?.map((a) => (
                  <div key={a.id} className="flex items-center justify-between py-3 text-sm first:pt-5 last:pb-5">
                    <span className="text-ink">{a.action.replace(/_/g, ' ')}</span>
                    <span className="text-ink/40">{new Date(a.createdAt).toLocaleString(locale)}</span>
                  </div>
                ))}
                {auditEntries?.length === 0 && <p className="py-5 text-sm text-ink/40">{t('lifecycle.noAudit')}</p>}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {isDeleteConfirm && (
        <ConfirmDialog
          title={t('clients.deleteTitle')}
          message={t('clients.confirmDelete', { name: client.fullName })}
          tone="danger"
          confirmLabel={t('common.delete')}
          pending={deleteMutation.isPending}
          error={
            deleteMutation.error instanceof ApiError
              ? deleteMutation.error.message
              : deleteMutation.error
                ? t('common.actionFailed')
                : null
          }
          onCancel={() => setIsDeleteConfirm(false)}
          onConfirm={() => deleteMutation.mutate(client.id, { onSuccess: () => router.push('/clients') })}
        />
      )}
    </div>
  );
}
