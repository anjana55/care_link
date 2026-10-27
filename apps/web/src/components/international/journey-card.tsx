'use client';

import { useState } from 'react';
import { CheckCircle2, Circle, Plane } from 'lucide-react';
import { CONTACT_ABROAD_LIMITS, type DepartureChecklistItem, type StaffPlacement } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useUpdateChecklistItem, useUpdatePlacement } from '@/lib/hooks/use-international';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';
import { day } from './shared';

const todayColombo = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/**
 * Getting the caregiver there: the nine pre-departure steps (the caregiver
 * sees them, ticked, with any note), the flight, and where they live and can
 * be reached abroad - which the caregiver keeps up to date themselves.
 */
export function JourneyCard({ placement: p }: { placement: StaffPlacement }) {
  const { t } = useTranslation();
  const done = p.journey.checklist.filter((c) => c.done).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plane size={18} aria-hidden />
          {t('international.journey.title')}
          <span className="text-sm font-normal text-ink/60">{t('international.journey.progress', { done, total: p.journey.checklist.length })}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <ul className="divide-y divide-border rounded border border-border">
          {p.journey.checklist.map((c) => (
            <ChecklistRow key={`${c.item}-${c.doneOn}-${c.note}-${c.dueOn}`} placementId={p.id} item={c} />
          ))}
        </ul>
        <ContactForm placement={p} />
      </CardContent>
    </Card>
  );
}

function ChecklistRow({ placementId, item: c }: { placementId: string; item: DepartureChecklistItem }) {
  const { t, locale } = useTranslation();
  const update = useUpdateChecklistItem(placementId);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(c.note ?? '');
  const [dueOn, setDueOn] = useState(c.dueOn ?? '');

  return (
    <li className="px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={c.done}
          disabled={update.isPending}
          onClick={() => update.mutate({ item: c.item, body: { done: !c.done } })}
          className="flex items-center gap-2 text-left"
        >
          {c.done ? <CheckCircle2 size={18} className="text-brand" aria-hidden /> : <Circle size={18} className="text-ink/30" aria-hidden />}
          <span className={c.done ? 'text-ink' : 'text-ink/80'}>{t(`international.journey.items.${c.item}`)}</span>
        </button>
        {c.done && c.doneOn && <span className="text-xs text-ink/50">{day(c.doneOn, locale)}</span>}
        {!c.done && c.dueOn && (
          <span className={`text-xs ${c.dueOn < todayColombo() ? 'font-medium text-danger' : 'text-ink/50'}`}>{t('international.journey.due', { date: day(c.dueOn, locale) })}</span>
        )}
        <button type="button" onClick={() => setEditing(!editing)} className="ml-auto text-xs text-brand-dark hover:underline">
          {editing ? t('common.cancel') : t('international.journey.edit')}
        </button>
      </div>
      {c.note && !editing && <p className="ml-7 mt-0.5 text-xs text-ink/60">{c.note}</p>}
      {editing && (
        <form
          className="ml-7 mt-2 grid gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ item: c.item, body: { note: note.trim() || null, dueOn: dueOn || null } }, { onSuccess: () => setEditing(false) });
          }}
        >
          <div>
            <Label htmlFor={`n-${c.item}`}>{t('international.journey.note')}</Label>
            <Input id={`n-${c.item}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={t('international.journey.notePlaceholder')} />
          </div>
          <div>
            <Label htmlFor={`d-${c.item}`}>{t('international.journey.dueLabel')}</Label>
            <Input id={`d-${c.item}`} type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          </div>
          <Button size="sm" type="submit" disabled={update.isPending}>
            {t('common.save')}
          </Button>
        </form>
      )}
      {update.isError && <p className="ml-7 mt-1 text-xs text-danger">{update.error instanceof Error ? update.error.message : t('common.actionFailed')}</p>}
    </li>
  );
}

function ContactForm({ placement: p }: { placement: StaffPlacement }) {
  const { t } = useTranslation();
  const update = useUpdatePlacement(p.id);
  const [departureDetails, setDepartureDetails] = useState(p.journey.departureDetails ?? '');
  const [phone, setPhone] = useState(p.journey.phoneAbroad ?? '');
  const [address, setAddress] = useState(p.journey.addressAbroad ?? '');
  const [saved, setSaved] = useState(false);
  const dirty = departureDetails !== (p.journey.departureDetails ?? '') || phone !== (p.journey.phoneAbroad ?? '') || address !== (p.journey.addressAbroad ?? '');

  return (
    <form
      className="space-y-3 border-t border-border pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        update.mutate({ departureDetails: departureDetails.trim() || null, phoneAbroad: phone.trim() || null, addressAbroad: address.trim() || null }, { onSuccess: () => setSaved(true) });
      }}
    >
      <div>
        <Label htmlFor="j-flight">{t('international.journey.flight')}</Label>
        <Input id="j-flight" value={departureDetails} onChange={(e) => setDepartureDetails(e.target.value)} maxLength={CONTACT_ABROAD_LIMITS.departureDetails} placeholder={t('international.journey.flightPlaceholder')} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="j-phone">{t('international.journey.phone')}</Label>
          <Input id="j-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={CONTACT_ABROAD_LIMITS.phone} />
        </div>
        <div>
          <Label htmlFor="j-address">{t('international.journey.address')}</Label>
          <Textarea id="j-address" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={CONTACT_ABROAD_LIMITS.address} />
        </div>
      </div>
      <p className="text-xs text-ink/50">{t('international.journey.contactHint')}</p>
      {update.isError && <p className="text-xs text-danger">{update.error instanceof Error ? update.error.message : t('common.actionFailed')}</p>}
      <div className="flex items-center gap-3">
        <Button size="sm" type="submit" disabled={!dirty || update.isPending}>
          {t('common.save')}
        </Button>
        {saved && <span className="text-xs text-brand-dark">{t('international.detail.saved')}</span>}
      </div>
    </form>
  );
}
