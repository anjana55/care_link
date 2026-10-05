'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { PhoneLink } from '@/components/clients/contact-links';
import type { Client } from '@/lib/api/types';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-1.5 text-sm">
      <dt className="text-ink/50">{label}</dt>
      <dd className="col-span-2 break-words text-ink">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border py-3 first:border-t-0 first:pt-0">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/50">{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

export function ClientDetailModal({ client, onClose }: { client: Client; onClose: () => void }) {
  const { t, locale } = useTranslation();
  const none = <span className="text-ink/40">{t('clients.notProvided')}</span>;
  const opt = (group: string, value: string | null) => (value ? t(`clients.options.${group}.${value}`) : none);
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale) : none);
  // Clients who registered before the care questions existed have none of them.
  const isLegacy = client.registrantType === null;
  const guardian = client.registrantType === 'GUARDIAN';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label={t('clients.detail.title')}>
      <div className="max-h-full w-full max-w-xl overflow-y-auto rounded-lg border border-border bg-white p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">{client.fullName}</h2>
            <p className="text-xs text-ink/50">{t('clients.detail.title')}</p>
          </div>
          <button onClick={onClose} aria-label={t('clients.detail.close')} className="rounded p-1 text-ink/50 hover:bg-paper hover:text-ink">
            <X size={18} />
          </button>
        </div>

        {isLegacy && <p className="mb-4 rounded bg-accent-light px-3 py-2 text-xs text-accent">{t('clients.detail.legacyNote')}</p>}

        <Section title={t('clients.detail.accountHolder')}>
          <Row label={t('clients.field.fullName')}>{client.fullName}</Row>
          <Row label={t('clients.field.registeredAs')}>{opt('registrantType', client.registrantType)}</Row>
        </Section>

        {guardian && (
          <Section title={t('clients.detail.recipient')}>
            <Row label={t('clients.field.recipientName')}>{client.recipientName ?? none}</Row>
            <Row label={t('clients.field.relationship')}>{opt('relationship', client.recipientRelationship)}</Row>
            <Row label={t('clients.field.age')}>{client.recipientAge ?? none}</Row>
            <Row label={t('clients.field.gender')}>{opt('gender', client.recipientGender)}</Row>
          </Section>
        )}
        {client.registrantType === 'SELF' && (
          <Section title={t('clients.detail.recipient')}>
            <Row label={t('clients.field.age')}>{client.recipientAge ?? none}</Row>
            <Row label={t('clients.field.gender')}>{opt('gender', client.recipientGender)}</Row>
          </Section>
        )}

        <Section title={t('clients.detail.contact')}>
          <Row label={t('clients.field.preferredContact')}>{opt('contactMethod', client.preferredContactMethod)}</Row>
          <Row label={t('clients.field.preferredTime')}>{opt('contactTime', client.preferredContactTime)}</Row>
          <Row label={t('clients.field.phone')}>{client.phone ? <PhoneLink phone={client.phone} /> : none}</Row>
          {client.accountPhone && <Row label={t('clients.field.whatsapp')}><PhoneLink phone={client.accountPhone} whatsapp /></Row>}
          {client.alternatePhone && <Row label={t('clients.field.alternatePhone')}><PhoneLink phone={client.alternatePhone} /></Row>}
          {client.email && (
            <Row label={t('clients.field.email')}>
              <a href={`mailto:${client.email}`} className="text-brand-dark hover:underline">{client.email}</a>
            </Row>
          )}
        </Section>

        <Section title={t('clients.detail.location')}>
          <Row label={t('clients.field.district')}>{client.district ?? none}</Row>
          <Row label={t('clients.field.city')}>{client.city ?? none}</Row>
          <Row label={t('clients.field.address')}>{client.careAddress ?? none}</Row>
        </Section>

        <Section title={t('clients.detail.care')}>
          <Row label={t('clients.field.careNeeds')}><span className="whitespace-pre-wrap">{client.careNeeds ?? none}</span></Row>
          <Row label={t('clients.field.schedule')}>{opt('careSchedule', client.careSchedule)}</Row>
          <Row label={t('clients.field.start')}>{opt('careStart', client.careStart)}</Row>
          <Row label={t('clients.field.caregiverGender')}>{opt('caregiverGender', client.preferredCaregiverGender)}</Row>
        </Section>

        <Section title={t('clients.detail.account')}>
          {/* Either channel counts: a WhatsApp client has no email to confirm,
              an email client no number to confirm. */}
          <Row label={t('clients.field.verification')}>
            {client.emailVerifiedAt || client.accountPhone ? t('clients.verified') : t('clients.unverified')}
          </Row>
          <Row label={t('clients.field.accountStatus')}>{client.isActive ? t('clients.active') : t('clients.inactive')}</Row>
          <Row label={t('clients.field.registeredOn')}>{date(client.createdAt)}</Row>
          <Row label={t('clients.field.lastLogin')}>{date(client.lastLoginAt)}</Row>
          <Row label={t('clients.field.consent')}>{date(client.consentAcceptedAt)}</Row>
        </Section>

        <div className="mt-4 flex justify-end">
          <Button variant="secondary" size="sm" onClick={onClose}>{t('clients.detail.close')}</Button>
        </div>
      </div>
    </div>
  );
}
