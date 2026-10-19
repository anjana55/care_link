'use client';

import type { ReactNode } from 'react';
import { useTranslation } from '@/lib/i18n/provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PhoneLink } from '@/components/clients/contact-links';
import type { Client } from '@/lib/api/types';

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2 last:border-0">
      <span className="text-sm text-ink/60">{label}</span>
      <span className="break-words text-right text-sm text-ink">{children}</span>
    </div>
  );
}

/**
 * Read-only overview of a client: who registered, who needs care, how to reach
 * them, where and what care is needed, plus the staff-maintained profile.
 * This used to live in a modal opened from the list; it now sits on the
 * client's page, the same place a caregiver's overview lives.
 *
 * Must be given the DETAIL payload (useClient), not a list row: the list masks
 * phone numbers, and these are tap-to-call links.
 */
export function ClientOverview({ client }: { client: Client }) {
  const { t, locale } = useTranslation();
  const none = <span className="text-ink/40">{t('clients.notProvided')}</span>;
  const opt = (group: string, value: string | null | undefined) => (value ? t(`clients.options.${group}.${value}`) : none);
  const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(locale) : none);
  // Clients who registered before the care questions existed have none of them.
  const isLegacy = client.registrantType === null;
  const guardian = client.registrantType === 'GUARDIAN';

  return (
    <div className="space-y-4">
      {isLegacy && <p className="rounded bg-accent-light px-3 py-2 text-xs text-accent">{t('clients.detail.legacyNote')}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title={guardian ? t('clients.detail.recipient') : t('clients.detail.accountHolder')}>
          <Row label={t('clients.field.registeredAs')}>{opt('registrantType', client.registrantType)}</Row>
          {guardian && (
            <>
              <Row label={t('clients.field.recipientName')}>{client.recipientName ?? none}</Row>
              <Row label={t('clients.field.relationship')}>{opt('relationship', client.recipientRelationship)}</Row>
            </>
          )}
          <Row label={t('clients.field.age')}>{client.recipientAge ?? none}</Row>
          <Row label={t('clients.field.gender')}>{opt('gender', client.recipientGender)}</Row>
        </Panel>

        <Panel title={t('clients.detail.contact')}>
          <Row label={t('clients.field.preferredContact')}>{opt('contactMethod', client.preferredContactMethod)}</Row>
          <Row label={t('clients.field.preferredTime')}>{opt('contactTime', client.preferredContactTime)}</Row>
          <Row label={t('clients.field.phone')}>{client.phone ? <PhoneLink phone={client.phone} /> : none}</Row>
          {client.accountPhone && (
            <Row label={t('clients.field.whatsapp')}>
              <PhoneLink phone={client.accountPhone} whatsapp />
            </Row>
          )}
          {client.alternatePhone && (
            <Row label={t('clients.field.alternatePhone')}>
              <PhoneLink phone={client.alternatePhone} />
            </Row>
          )}
          <Row label={t('clients.field.email')}>
            {client.email ? (
              <a href={`mailto:${client.email}`} className="text-brand-dark hover:underline">
                {client.email}
              </a>
            ) : (
              t('clients.detail.noEmail')
            )}
          </Row>
        </Panel>

        <Panel title={t('clients.detail.care')}>
          <Row label={t('clients.field.careNeeds')}>
            <span className="whitespace-pre-wrap">{client.careNeeds ?? none}</span>
          </Row>
          <Row label={t('clients.field.schedule')}>{opt('careSchedule', client.careSchedule)}</Row>
          <Row label={t('clients.field.start')}>{opt('careStart', client.careStart)}</Row>
          <Row label={t('clients.field.caregiverGender')}>{opt('caregiverGender', client.preferredCaregiverGender)}</Row>
        </Panel>

        <Panel title={t('clients.detail.location')}>
          <Row label={t('clients.field.district')}>{client.district ?? none}</Row>
          <Row label={t('clients.field.city')}>{client.city ?? none}</Row>
          <Row label={t('clients.field.address')}>{client.careAddress ?? none}</Row>
        </Panel>

        <Panel title={t('clients.detail.profile')}>
          <Row label={t('personalInfo.fields.fullName')}>{client.fullName}</Row>
          <Row label={t('personalInfo.fields.permanentAddress')}>{client.permanentAddress || none}</Row>
          <Row label={t('personalInfo.fields.dateOfBirth')}>
            {client.dateOfBirth ? client.dateOfBirth.slice(0, 10) : none}
          </Row>
          <Row label={t('personalInfo.fields.gender')}>
            {client.gender ? t(`personalInfo.options.gender.${client.gender}`) : none}
          </Row>
          <Row label={t('personalInfo.fields.nic')}>{client.nic || none}</Row>
          <Row label={t('personalInfo.fields.postalCode')}>{client.postalCode || none}</Row>
        </Panel>

        <Panel title={t('clients.detail.registration')}>
          <Row label={t('clients.detail.registered')}>{date(client.createdAt)}</Row>
          <Row label={t('clients.detail.updated')}>{date(client.updatedAt)}</Row>
          <Row label={t('clients.detail.consent')}>{date(client.consentAcceptedAt)}</Row>
          {client.notes && (
            <Row label={t('clients.form.notes')}>
              <span className="whitespace-pre-wrap">{client.notes}</span>
            </Row>
          )}
        </Panel>
      </div>
    </div>
  );
}
