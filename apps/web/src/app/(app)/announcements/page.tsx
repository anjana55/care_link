'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Megaphone } from 'lucide-react';
import { ANNOUNCEMENT_AUDIENCES, MAX_ANNOUNCEMENT_BODY, MAX_ANNOUNCEMENT_TITLE, type Announcement, type AnnouncementAudience } from '@care-platform/shared';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { useAnnouncements, useDeleteAnnouncement, usePublishAnnouncement, useSaveAnnouncement, type AnnouncementBody } from '@/lib/hooks/use-announcements';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label, RequiredLegend, Select, Textarea } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

type Lang = 'en' | 'si' | 'ta';
const LANGS: Lang[] = ['en', 'si', 'ta'];

interface Draft {
  id?: string;
  audience: AnnouncementAudience;
  text: Record<Lang, { title: string; body: string }>;
  link: string;
  important: boolean;
  sendPush: boolean;
  sendWhatsapp: boolean;
}

const EMPTY: Draft = {
  audience: 'ALL',
  text: { en: { title: '', body: '' }, si: { title: '', body: '' }, ta: { title: '', body: '' } },
  link: '',
  important: false,
  sendPush: true,
  sendWhatsapp: false,
};

/** Sinhala and Tamil the same as English were filled in from it: show them empty again when editing. */
function draftOf(a: Announcement): Draft {
  const own = (l: 'si' | 'ta') => ({
    title: a.text[l].title === a.text.en.title ? '' : a.text[l].title,
    body: a.text[l].body === a.text.en.body ? '' : a.text[l].body,
  });
  return { id: a.id, audience: a.audience, text: { en: a.text.en, si: own('si'), ta: own('ta') }, link: a.link ?? '', important: a.important, sendPush: a.sendPush, sendWhatsapp: a.sendWhatsapp };
}

function bodyOf(d: Draft): AnnouncementBody {
  return {
    audience: d.audience,
    en: { title: d.text.en.title.trim(), body: d.text.en.body.trim() },
    si: { title: d.text.si.title.trim(), body: d.text.si.body.trim() },
    ta: { title: d.text.ta.title.trim(), body: d.text.ta.body.trim() },
    link: d.link.trim() || null,
    important: d.important,
    sendPush: d.sendPush,
    sendWhatsapp: d.sendWhatsapp,
  };
}

const fmt = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

/**
 * Announcements (ADMIN + STAFF): a message from the office to every client,
 * every caregiver, or both - holiday hours, a rate change, a safety notice.
 * Saved as a draft, then published into each person's notifications on the
 * website and in the app, with a push (and WhatsApp, which costs per message,
 * only when ticked). Unpublishing takes it out of everyone's notifications.
 */
export default function AnnouncementsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useRouter();
  const allowed = user?.role === 'ADMIN' || user?.role === 'STAFF';
  const { data, isLoading, isError } = useAnnouncements(allowed);
  const save = useSaveAnnouncement();
  const publish = usePublishAnnouncement();
  const remove = useDeleteAnnouncement();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [tab, setTab] = useState<Lang>('en');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'publish' | 'delete'; a: Announcement } | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    if (user && !allowed) router.replace('/dashboard');
  }, [user, allowed, router]);
  if (!allowed) return null;

  const errorOf = (err: unknown) => (err instanceof ApiError && err.message ? err.message : t('announcements.saveError'));
  const setText = (lang: Lang, patch: Partial<{ title: string; body: string }>) => setDraft({ ...draft, text: { ...draft.text, [lang]: { ...draft.text[lang], ...patch } } });
  const ready = draft.text.en.title.trim() && draft.text.en.body.trim();

  const submit = () => {
    setError(null);
    setNotice(null);
    save.mutate(
      { id: draft.id, body: bodyOf(draft) },
      {
        onSuccess: () => {
          setDraft(EMPTY);
          setTab('en');
          setNotice(t('announcements.savedDraft'));
        },
        onError: (err) => setError(errorOf(err)),
      },
    );
  };

  const runConfirm = () => {
    if (!confirm) return;
    setConfirmError(null);
    const done = { onSuccess: () => setConfirm(null), onError: (err: unknown) => setConfirmError(errorOf(err)) };
    if (confirm.kind === 'publish') publish.mutate(confirm.a.id, done);
    else remove.mutate(confirm.a.id, done);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">{t('announcements.title')}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink/60">{t('announcements.subtitle')}</p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-5">
          <h2 className="text-base font-semibold text-ink">{draft.id ? t('announcements.editTitle') : t('announcements.newTitle')}</h2>
          <RequiredLegend label={t('common.requiredField')} />
          <div>
            <Label htmlFor="audience" required>
              {t('announcements.audience')}
            </Label>
            <Select id="audience" value={draft.audience} onChange={(e) => setDraft({ ...draft, audience: e.target.value as AnnouncementAudience })} className="max-w-xs">
              {ANNOUNCEMENT_AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {t(`announcements.audiences.${a}`)}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <div role="tablist" aria-label={t('announcements.language')} className="mb-3 flex gap-1">
              {LANGS.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="tab"
                  aria-selected={tab === l}
                  onClick={() => setTab(l)}
                  className={`rounded px-3 py-1.5 text-sm font-medium ${tab === l ? 'bg-brand-light text-brand-dark' : 'text-ink/70 hover:bg-paper'}`}
                >
                  {t(`announcements.languages.${l}`)}
                </button>
              ))}
            </div>
            {tab !== 'en' && <p className="mb-2 text-xs text-ink/50">{t('announcements.fallbackHint')}</p>}
            <div className="space-y-3">
              <div>
                <Label htmlFor={`title-${tab}`} required={tab === 'en'}>
                  {t('announcements.messageTitle')}
                </Label>
                <Input id={`title-${tab}`} maxLength={MAX_ANNOUNCEMENT_TITLE} value={draft.text[tab].title} onChange={(e) => setText(tab, { title: e.target.value })} placeholder={tab === 'en' ? '' : draft.text.en.title} />
              </div>
              <div>
                <Label htmlFor={`body-${tab}`} required={tab === 'en'}>
                  {t('announcements.message')}
                </Label>
                <Textarea id={`body-${tab}`} rows={4} maxLength={MAX_ANNOUNCEMENT_BODY} value={draft.text[tab].body} onChange={(e) => setText(tab, { body: e.target.value })} placeholder={tab === 'en' ? '' : draft.text.en.body} />
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="link">{t('announcements.link')}</Label>
            <Input id="link" value={draft.link} onChange={(e) => setDraft({ ...draft, link: e.target.value })} placeholder="/account/bookings" className="max-w-md" aria-describedby="link-hint" />
            <p id="link-hint" className="mt-1 text-xs text-ink/50">
              {t('announcements.linkHint')}
            </p>
          </div>

          <div className="space-y-2">
            {(
              [
                ['important', 'announcements.important', 'announcements.importantHint'],
                ['sendPush', 'announcements.sendPush', 'announcements.sendPushHint'],
                ['sendWhatsapp', 'announcements.sendWhatsapp', 'announcements.sendWhatsappHint'],
              ] as const
            ).map(([key, label, hint]) => (
              <label key={key} className="flex items-start gap-3">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })} />
                <span>
                  <span className="block text-sm font-medium text-ink">{t(label)}</span>
                  <span className="block text-xs text-ink/50">{t(hint)}</span>
                </span>
              </label>
            ))}
          </div>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={submit} disabled={!ready || save.isPending}>
              {save.isPending ? t('common.loading') : t('announcements.saveDraft')}
            </Button>
            {draft.id && (
              <Button variant="secondary" onClick={() => setDraft(EMPTY)}>
                {t('common.cancel')}
              </Button>
            )}
            {notice && (
              <span role="status" className="text-sm text-brand-dark">
                {notice}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="sent">
        <h2 id="sent" className="mb-2 text-base font-semibold text-ink">
          {t('announcements.listTitle')}
        </h2>
        {isLoading ? (
          <p className="text-sm text-ink/50">{t('common.loading')}</p>
        ) : isError ? (
          <p className="text-sm text-danger">{t('announcements.loadError')}</p>
        ) : !data?.length ? (
          <p className="text-sm text-ink/50">{t('announcements.empty')}</p>
        ) : (
          <ul className="space-y-3">
            {data.map((a) => (
              <li key={a.id}>
                <Card>
                  <CardContent className="space-y-2 pt-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
                        <div className="min-w-0">
                          <p className="font-medium text-ink">{a.text.en.title}</p>
                          <p className="whitespace-pre-line text-sm text-ink/70">{a.text.en.body}</p>
                        </div>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${a.publishedAt ? 'bg-brand-light text-brand-dark' : 'bg-paper text-ink/60'}`}>
                        {a.publishedAt ? t('announcements.published') : t('announcements.draft')}
                      </span>
                    </div>
                    <p className="text-xs text-ink/50">
                      {t(`announcements.audiences.${a.audience}`)}
                      {a.important ? ` · ${t('announcements.important')}` : ''}
                      {a.sendPush ? ` · ${t('announcements.push')}` : ''}
                      {a.sendWhatsapp ? ` · WhatsApp` : ''}
                      {a.link ? ` · ${a.link}` : ''}
                    </p>
                    <p className="text-xs text-ink/50">
                      {a.publishedAt
                        ? t('announcements.publishedLine', { date: fmt(a.publishedAt), recipients: a.recipients, read: a.readCount })
                        : t('announcements.createdLine', { date: fmt(a.createdAt), name: a.createdByName ?? '—' })}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {!a.publishedAt && (
                        <>
                          <Button size="sm" onClick={() => setConfirm({ kind: 'publish', a })}>
                            {t('announcements.publish')}
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setDraft(draftOf(a))}>
                            {t('announcements.edit')}
                          </Button>
                        </>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'delete', a })}>
                        {a.publishedAt ? t('announcements.unpublish') : t('announcements.delete')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'publish' ? t('announcements.confirmPublishTitle') : confirm.a.publishedAt ? t('announcements.confirmUnpublishTitle') : t('announcements.confirmDeleteTitle')}
          message={
            confirm.kind === 'publish'
              ? t('announcements.confirmPublish', { audience: t(`announcements.audiences.${confirm.a.audience}`).toLowerCase() })
              : confirm.a.publishedAt
                ? t('announcements.confirmUnpublish')
                : t('announcements.confirmDelete')
          }
          confirmLabel={confirm.kind === 'publish' ? t('announcements.publish') : confirm.a.publishedAt ? t('announcements.unpublish') : t('announcements.delete')}
          tone={confirm.kind === 'publish' ? 'primary' : 'danger'}
          pending={publish.isPending || remove.isPending}
          error={confirmError}
          onConfirm={runConfirm}
          onCancel={() => {
            setConfirm(null);
            setConfirmError(null);
          }}
        />
      )}
    </div>
  );
}
