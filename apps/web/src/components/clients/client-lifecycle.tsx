'use client';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { useSetClientActive, useUpdateClientStatus } from '@/lib/hooks/use-clients';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StatusMoveSelect, type StatusMoveConfirmation } from '@/components/ui/status-move-select';
import { Panel, Row } from '@/components/clients/client-overview';
import { CLIENT_STATUS_OPTIONS, allowedNextClientStatuses } from '@/lib/client-status';
import { cn } from '@/lib/utils';
import type { Client, ClientStatus } from '@/lib/api/types';

/**
 * The client's lifecycle has two independent switches, and staff need to see
 * both:
 *
 *  - status (PENDING_REVIEW -> ACTIVE / INACTIVE / SUSPENDED): the review
 *    state, STAFF + ADMIN. INACTIVE and SUSPENDED clients can still sign in
 *    and look around but cannot send new care requests
 *    (CareRequestsService.create). Existing requests and bookings are untouched.
 *  - sign-in access (users.isActive): ADMIN only. Turning it off revokes the
 *    client's refresh tokens so they cannot sign in at all.
 */

function errorText(err: unknown, fallback: string): string | null {
  if (!err) return null;
  return err instanceof ApiError ? err.message : fallback;
}

/** The "Move to…" control for a client, with the right confirmation per target. */
export function ClientStatusMove({ client, className }: { client: Client; className?: string }) {
  const { t } = useTranslation();
  const mutation = useUpdateClientStatus(client.id);
  const label = (s: ClientStatus) => t(`clients.status.${s}`);

  const confirmFor = (s: ClientStatus): StatusMoveConfirmation => {
    const restrictive = s === 'INACTIVE' || s === 'SUSPENDED';
    return {
      title: t(`lifecycle.client.to.${s}.title`, { name: client.fullName }),
      message: t(`lifecycle.client.to.${s}.message`),
      tone: restrictive ? 'danger' : 'primary',
    };
  };

  return (
    <StatusMoveSelect
      statuses={allowedNextClientStatuses(client.status)}
      labelOf={label}
      confirmFor={confirmFor}
      pending={mutation.isPending}
      error={errorText(mutation.error, t('common.actionFailed'))}
      onReset={() => mutation.reset()}
      onMove={(s, done) => mutation.mutate(s, { onSuccess: done })}
      className={className}
    />
  );
}

export function ClientLifecyclePanels({ client, isAdmin }: { client: Client; isAdmin: boolean }) {
  const { t, locale } = useTranslation();
  const activeMutation = useSetClientActive(client.id);
  const [confirmAccess, setConfirmAccess] = useState(false);
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale) : t('clients.never'));
  const next = allowedNextClientStatuses(client.status);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Panel title={t('lifecycle.client.statusTitle')}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <StatusBadge status={client.status} label={t(`clients.status.${client.status}`)} />
          <span className="text-sm text-ink/70">{t(`lifecycle.client.meaning.${client.status}`)}</span>
        </div>

        {/* The whole ladder, so staff can see where this client sits and
            what each state does without guessing. */}
        <ol className="mb-4 space-y-1.5">
          {CLIENT_STATUS_OPTIONS.map((s) => (
            <li
              key={s}
              className={cn(
                'flex items-start gap-2 rounded px-2 py-1.5 text-xs',
                s === client.status ? 'bg-brand-light text-brand-dark' : 'text-ink/60',
              )}
            >
              <span className="w-28 shrink-0 font-medium">{t(`clients.status.${s}`)}</span>
              <span>{t(`lifecycle.client.meaning.${s}`)}</span>
            </li>
          ))}
        </ol>

        {next.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-ink/60">{t('lifecycle.changeStatus')}</span>
            <ClientStatusMove client={client} className="w-48" />
          </div>
        ) : (
          <p className="text-sm text-ink/50">{t('lifecycle.noMoves')}</p>
        )}
      </Panel>

      <Panel title={t('lifecycle.client.accessTitle')}>
        <Row label={t('clients.detail.isActive')}>
          {client.isActive ? t('lifecycle.client.canSignIn') : t('lifecycle.client.cannotSignIn')}
        </Row>
        <Row label={t('clients.detail.whatsappNumber')}>{client.accountPhone || t('clients.detail.notLinked')}</Row>
        <Row label={t('clients.detail.emailVerified')}>
          {client.emailVerifiedAt ? date(client.emailVerifiedAt) : t('clients.detail.emailUnverified')}
        </Row>
        <Row label={t('clients.detail.lastLogin')}>{date(client.lastLoginAt)}</Row>

        <p className="mt-3 text-xs text-ink/50">{t('lifecycle.client.accessHint')}</p>

        {isAdmin && (
          <div className="mt-3">
            <Button
              variant={client.isActive ? 'secondary' : 'primary'}
              size="sm"
              onClick={() => {
                activeMutation.reset();
                setConfirmAccess(true);
              }}
            >
              {client.isActive ? t('clients.actions.deactivate') : t('clients.actions.activate')}
            </Button>
          </div>
        )}
      </Panel>

      {confirmAccess && (
        <ConfirmDialog
          title={client.isActive ? t('clients.actions.deactivate') : t('clients.actions.activate')}
          message={
            client.isActive
              ? t('lifecycle.client.deactivateMessage', { name: client.fullName })
              : t('lifecycle.client.activateMessage', { name: client.fullName })
          }
          tone={client.isActive ? 'danger' : 'primary'}
          pending={activeMutation.isPending}
          error={errorText(activeMutation.error, t('common.actionFailed'))}
          onCancel={() => setConfirmAccess(false)}
          onConfirm={() => activeMutation.mutate(!client.isActive, { onSuccess: () => setConfirmAccess(false) })}
        />
      )}
    </div>
  );
}
