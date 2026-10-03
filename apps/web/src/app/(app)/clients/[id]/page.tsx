'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { useClient, useSetClientActive, useUpdateClientStatus } from '@/lib/hooks/use-clients';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import type { ClientStatus } from '@/lib/api/types';

const STATUSES: ClientStatus[] = ['PENDING_REVIEW', 'ACTIVE', 'INACTIVE', 'SUSPENDED'];

export default function ClientDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { data: client, isLoading, isError } = useClient(id);

  const statusMutation = useUpdateClientStatus(id);
  const activeMutation = useSetClientActive(id);

  const isAdmin = user?.role === 'ADMIN';
  const canEdit = isAdmin || user?.role === 'STAFF';

  function fmt(value: string | null, fallback: string) {
    return value ? new Date(value).toLocaleString() : fallback;
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

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">{client.fullName}</h1>
        <StatusBadge status={client.status} label={t(`clients.status.${client.status}`)} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title={t('clients.detail.contact')}>
          <Row label={t('clients.table.name')} value={client.fullName} />
          <Row label={t('clients.detail.phone')} value={client.phone || '—'} />
          <Row
            label={t('clients.detail.email')}
            value={client.email || t('clients.detail.noEmail')}
          />
        </Panel>

        <Panel title={t('clients.detail.account')}>
          <Row
            label={t('clients.detail.isActive')}
            value={client.isActive ? t('clients.account.active') : t('clients.account.inactive')}
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
          <Row
            label={t('clients.detail.consent')}
            value={fmt(client.consentAcceptedAt, t('clients.detail.notRecorded'))}
          />
        </Panel>

        {canEdit && (
          <Panel title={t('clients.changeStatus')}>
            <div className="flex flex-col gap-3">
              <Select
                value={client.status}
                disabled={statusMutation.isPending}
                onChange={(e) => statusMutation.mutate(e.target.value as ClientStatus)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`clients.status.${s}`)}
                  </option>
                ))}
              </Select>

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