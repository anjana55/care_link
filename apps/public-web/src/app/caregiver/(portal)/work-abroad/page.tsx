'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, ImagePlus, Link2, Pause, Plane, Trash2, X } from 'lucide-react';
import {
  MAX_TARGET_COUNTRIES,
  SHARED_PROFILE_CONSENT_VERSION,
  SHARED_PROFILE_LIMITS,
  type CountryCode,
  type OverseasReadiness,
  type SharedProfileSettings,
} from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useCountryNames } from '@/lib/countries';
import { ApiError, fetchBlob } from '@/lib/api/client';
import { useCaregiverId } from '@/lib/hooks/use-caregiver-portal';
import {
  useMyTraining,
  useOverseasReadiness,
  useSaveOverseasReadiness,
  useSharedProfile,
  useSharedProfileAction,
  useTrainingInterest,
  useTrainingProgrammes,
} from '@/lib/hooks/use-international';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { TrainingProgrammeCard } from '@/components/international/training-programme-card';
import { EmployerInterestCard, ReadinessChecklist } from '@/components/international/readiness-checklist';
import { cn } from '@/lib/utils';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function Card({ id, title, intro, children }: { id: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 rounded-lg border border-border bg-white p-5 sm:p-6">
      <h2 id={`${id}-title`} className="text-lg font-semibold text-ink">
        {title}
      </h2>
      {intro && <p className="mt-1 text-sm text-ink/60">{intro}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/**
 * The caregiver's Work abroad section: whether (and where) they want to work
 * abroad, the platform's training, and a profile they can choose to share with
 * overseas employers.
 */
export default function WorkAbroadSectionPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink">{t('portal.workAbroad.title')}</h1>
        <p className="mt-1 text-sm text-ink/60">{t('portal.workAbroad.intro')}</p>
      </div>
      <EmployerInterestCard />
      <ReadinessChecklist />
      <ReadinessCard />
      <TrainingCard />
      <SharedProfileCard />
    </div>
  );
}

// --- readiness -----------------------------------------------------------------

function ReadinessCard() {
  const { t } = useTranslation();
  const countries = useCountryNames();
  const { data, isLoading, isError } = useOverseasReadiness();
  const save = useSaveOverseasReadiness();
  const [form, setForm] = useState<OverseasReadiness | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  if (isLoading || !form) return <Card id="readiness" title={t('portal.workAbroad.readiness.title')}>{isError ? <p className="text-sm text-danger">{t('portal.loadError')}</p> : <div className="h-24 animate-pulse rounded bg-paper" />}</Card>;

  const set = (patch: Partial<OverseasReadiness>) => {
    setNotice(null);
    setForm((f) => (f ? { ...f, ...patch } : f));
  };
  const addCountry = (code: string) => {
    if (!code || form.targetCountries.includes(code as CountryCode) || form.targetCountries.length >= MAX_TARGET_COUNTRIES) return;
    set({ targetCountries: [...form.targetCountries, code as CountryCode] });
  };

  return (
    <Card id="readiness" title={t('portal.workAbroad.readiness.title')} intro={t('portal.workAbroad.readiness.intro')}>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(form, { onSuccess: () => setNotice(t('portal.saved')) });
        }}
      >
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={form.openToOverseas}
            onChange={(e) => set({ openToOverseas: e.target.checked })}
            className="mt-0.5 h-5 w-5 rounded border-border text-brand focus:ring-brand"
          />
          <span>
            <span className="block text-sm font-semibold text-ink">{t('portal.workAbroad.readiness.open')}</span>
            <span className="block text-xs text-ink/60">{t('portal.workAbroad.readiness.openHint')}</span>
          </span>
        </label>

        <div>
          <Label htmlFor="wa-country">{t('portal.workAbroad.readiness.countries', { max: MAX_TARGET_COUNTRIES })}</Label>
          {form.targetCountries.length > 0 && (
            <ul className="mb-2 flex flex-wrap gap-2">
              {form.targetCountries.map((code) => (
                <li key={code} className="flex items-center gap-1 rounded-full bg-accent-light py-1 pl-3 pr-1.5 text-sm text-ink">
                  <Plane className="h-3.5 w-3.5 text-accent" aria-hidden />
                  {countries.name(code)}
                  <button
                    type="button"
                    onClick={() => set({ targetCountries: form.targetCountries.filter((c) => c !== code) })}
                    aria-label={t('portal.workAbroad.readiness.removeCountry', { country: countries.name(code) })}
                    className="rounded-full p-0.5 text-ink/50 hover:bg-white hover:text-ink"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Select id="wa-country" value="" onChange={(e) => addCountry(e.target.value)} disabled={form.targetCountries.length >= MAX_TARGET_COUNTRIES} className="sm:w-72">
            <option value="">{t('portal.workAbroad.readiness.addCountry')}</option>
            {countries.sorted
              .filter((c) => !form.targetCountries.includes(c.code))
              .map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
          </Select>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="wa-passport">{t('portal.workAbroad.readiness.passport')}</Label>
            <Select
              id="wa-passport"
              value={form.passportHeld === null ? '' : form.passportHeld ? 'yes' : 'no'}
              onChange={(e) => set({ passportHeld: e.target.value === '' ? null : e.target.value === 'yes', ...(e.target.value !== 'yes' ? { passportExpiry: null } : {}) })}
            >
              <option value="">—</option>
              <option value="yes">{t('portal.workAbroad.readiness.yes')}</option>
              <option value="no">{t('portal.workAbroad.readiness.no')}</option>
            </Select>
          </div>
          {form.passportHeld && (
            <div>
              <Label htmlFor="wa-expiry">{t('portal.workAbroad.readiness.passportExpiry')}</Label>
              <Input id="wa-expiry" type="date" value={form.passportExpiry ?? ''} onChange={(e) => set({ passportExpiry: e.target.value || null })} />
            </div>
          )}
          <div>
            <Label htmlFor="wa-available">{t('portal.workAbroad.readiness.availableFrom')}</Label>
            <Input id="wa-available" type="date" value={form.availableFrom ?? ''} onChange={(e) => set({ availableFrom: e.target.value || null })} />
          </div>
        </div>
        <p className="text-xs text-ink/50">{t('portal.workAbroad.readiness.passportNote')}</p>

        {save.isError && <p role="alert" className="text-sm text-danger">{errorText(save.error, t('portal.saveError'))}</p>}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={save.isPending}>
            {t('portal.workAbroad.save')}
          </Button>
          {notice && (
            <span role="status" className="flex items-center gap-1 text-sm text-brand-dark">
              <Check className="h-4 w-4" aria-hidden />
              {notice}
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}

// --- training ------------------------------------------------------------------

function TrainingCard() {
  const { t, locale } = useTranslation();
  const { data: programmes = [], isLoading } = useTrainingProgrammes(locale);
  const { data: mine = [] } = useMyTraining();
  const interest = useTrainingInterest();
  const statusOf = (id: string) => mine.find((m) => m.programmeId === id)?.status ?? null;

  return (
    <Card id="training" title={t('portal.workAbroad.training.title')} intro={t('portal.workAbroad.training.intro')}>
      {isLoading && <div className="h-24 animate-pulse rounded bg-paper" />}
      {!isLoading && programmes.length === 0 && <p className="text-sm text-ink/60">{t('workAbroad.training.empty')}</p>}
      {interest.isError && <p role="alert" className="mb-3 text-sm text-danger">{errorText(interest.error, t('portal.saveError'))}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {programmes.map((p) => {
          const status = statusOf(p.id);
          const active = status === 'INTERESTED' || status === 'ENROLLED';
          return (
            <TrainingProgrammeCard key={p.id} programme={p}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                {status && status !== 'WITHDRAWN' ? (
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                      status === 'COMPLETED' ? 'bg-brand text-white' : 'bg-brand-light text-brand-dark',
                    )}
                  >
                    {t(`portal.workAbroad.training.status.${status}`)}
                  </span>
                ) : (
                  <span />
                )}
                {status !== 'COMPLETED' && (
                  <Button
                    type="button"
                    size="sm"
                    variant={active ? 'secondary' : 'primary'}
                    disabled={interest.isPending}
                    onClick={() => interest.mutate({ programmeId: p.id, interested: !active })}
                  >
                    {active ? t('portal.workAbroad.training.withdraw') : t('portal.workAbroad.training.interested')}
                  </Button>
                )}
              </div>
              {status === 'INTERESTED' && <p className="mt-2 text-xs text-ink/60">{t('portal.workAbroad.training.interestedHint')}</p>}
            </TrainingProgrammeCard>
          );
        })}
      </div>
    </Card>
  );
}

// --- shared profile --------------------------------------------------------------

function usePhotoPreview(settings: SharedProfileSettings | undefined) {
  const id = useCaregiverId();
  const { data: url } = useQuery({
    queryKey: ['portal', id, 'shared-profile-photo', settings?.hasPhoto],
    queryFn: async () => URL.createObjectURL(await fetchBlob(`/caregivers/${id}/shared-profile/photo`)),
    enabled: Boolean(id && settings?.hasPhoto),
    staleTime: Infinity,
  });
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  return settings?.hasPhoto ? (url ?? null) : null;
}

function StatusBanner({ settings }: { settings: SharedProfileSettings }) {
  const { t } = useTranslation();
  const state = settings.isLive
    ? 'live'
    : settings.status === 'PENDING_REVIEW'
      ? 'pending'
      : settings.status === 'REJECTED'
        ? 'rejected'
        : settings.status === 'APPROVED' && !settings.isShared
          ? 'paused'
          : settings.status === 'APPROVED'
            ? 'notListed'
            : 'draft';
  const tone = {
    live: 'border-brand/30 bg-brand-light/50 text-brand-dark',
    pending: 'border-accent/30 bg-accent/5 text-accent-dark',
    rejected: 'border-danger/30 bg-danger/5 text-danger',
    paused: 'border-border bg-paper text-ink/70',
    notListed: 'border-border bg-paper text-ink/70',
    draft: 'border-border bg-paper text-ink/70',
  }[state];
  return (
    <div role="status" className={cn('rounded-DEFAULT border px-4 py-3 text-sm', tone)}>
      <p className="font-semibold">{t(`portal.workAbroad.share.state.${state}`)}</p>
      <p className="mt-0.5 text-xs opacity-90">{t(`portal.workAbroad.share.state.${state}Hint`)}</p>
      {state === 'rejected' && settings.reviewNote && (
        <p className="mt-2 rounded bg-white/70 px-3 py-2 text-xs text-ink">
          <span className="font-semibold">{t('portal.workAbroad.share.reviewNote')}</span> {settings.reviewNote}
        </p>
      )}
    </div>
  );
}

function SharedProfileCard() {
  const { t } = useTranslation();
  const { data: settings, isLoading, isError } = useSharedProfile();
  const action = useSharedProfileAction();
  const photo = usePhotoPreview(settings);
  const fileInput = useRef<HTMLInputElement>(null);
  const [firstName, setFirstName] = useState('');
  const [headline, setHeadline] = useState('');
  const [bio, setBio] = useState('');
  const [consent, setConsent] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setFirstName(settings.firstName);
    setHeadline(settings.headline ?? '');
    setBio(settings.bio ?? '');
  }, [settings]);

  if (isLoading || !settings) {
    return (
      <Card id="share" title={t('portal.workAbroad.share.title')}>
        {isError ? <p className="text-sm text-danger">{t('portal.loadError')}</p> : <div className="h-40 animate-pulse rounded bg-paper" />}
      </Card>
    );
  }

  const hasConsent = Boolean(settings.consentAcceptedAt) && settings.consentVersion === SHARED_PROFILE_CONSENT_VERSION;
  const dirty = firstName.trim() !== settings.firstName || (headline.trim() || null) !== settings.headline || (bio.trim() || null) !== settings.bio;
  const link = settings.slug ? `${window.location.origin}/talent/${settings.slug}` : null;

  const run = (a: Parameters<typeof action.mutate>[0], done?: string) => {
    setNotice(null);
    action.mutate(a, { onSuccess: () => done && setNotice(done) });
  };

  const onPhoto = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setNotice(null);
      action.reset();
      window.alert(t('portal.workAbroad.share.photoTooLarge'));
      return;
    }
    run({ kind: 'uploadPhoto', file }, t('portal.workAbroad.share.photoUploaded'));
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <Card id="share" title={t('portal.workAbroad.share.title')} intro={t('portal.workAbroad.share.intro')}>
      <div className="space-y-6">
        <StatusBanner settings={settings} />

        <div className="flex flex-col gap-5 sm:flex-row">
          <div className="flex flex-col items-center gap-2">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt={t('portal.workAbroad.share.photoAlt')} className="h-28 w-28 rounded-full object-cover" />
            ) : (
              <span className="flex h-28 w-28 items-center justify-center rounded-full bg-paper text-ink/30">
                <ImagePlus className="h-8 w-8" aria-hidden />
              </span>
            )}
            <input ref={fileInput} type="file" accept=".jpg,.jpeg,.png,.webp" className="sr-only" id="wa-photo" onChange={(e) => onPhoto(e.target.files?.[0])} />
            <label htmlFor="wa-photo" className="cursor-pointer text-sm font-medium text-brand hover:text-brand-dark">
              {settings.hasPhoto ? t('portal.workAbroad.share.changePhoto') : t('portal.workAbroad.share.addPhoto')}
            </label>
            {settings.hasPhoto && (
              <button type="button" onClick={() => run({ kind: 'deletePhoto' })} className="text-xs text-ink/50 hover:text-danger">
                {t('portal.workAbroad.share.removePhoto')}
              </button>
            )}
          </div>

          <form
            className="flex-1 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              run({ kind: 'save', body: { firstName: firstName.trim(), headline: headline.trim() || null, bio: bio.trim() || null } }, t('portal.saved'));
            }}
          >
            <div>
              <Label htmlFor="wa-first" required>
                {t('portal.workAbroad.share.firstName')}
              </Label>
              <Input id="wa-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={SHARED_PROFILE_LIMITS.firstName} required />
              <p className="mt-1 text-xs text-ink/50">{t('portal.workAbroad.share.firstNameHint')}</p>
            </div>
            <div>
              <Label htmlFor="wa-headline">{t('portal.workAbroad.share.headline')}</Label>
              <Input
                id="wa-headline"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                maxLength={SHARED_PROFILE_LIMITS.headline}
                placeholder={t('portal.workAbroad.share.headlinePlaceholder')}
              />
            </div>
            <div>
              <Label htmlFor="wa-bio">{t('portal.workAbroad.share.bio')}</Label>
              <Textarea id="wa-bio" rows={5} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={SHARED_PROFILE_LIMITS.bio} placeholder={t('portal.workAbroad.share.bioPlaceholder')} />
              <p className="mt-1 flex justify-between gap-3 text-xs text-ink/50">
                <span>{t('portal.workAbroad.share.bioHint')}</span>
                <span>
                  {bio.length}/{SHARED_PROFILE_LIMITS.bio}
                </span>
              </p>
            </div>
            {settings.status !== 'DRAFT' && dirty && <p className="text-xs text-accent-dark">{t('portal.workAbroad.share.reReview')}</p>}
            <Button type="submit" variant="secondary" disabled={!dirty || !firstName.trim() || action.isPending}>
              {t('portal.workAbroad.share.saveDetails')}
            </Button>
          </form>
        </div>

        {action.isError && <p role="alert" className="text-sm text-danger">{errorText(action.error, t('portal.saveError'))}</p>}
        {notice && (
          <p role="status" className="flex items-center gap-1 text-sm text-brand-dark">
            <Check className="h-4 w-4" aria-hidden />
            {notice}
          </p>
        )}

        {/* Consent and the switch */}
        <div className="rounded-lg border border-border p-4">
          {!settings.isShared ? (
            <>
              {!hasConsent && (
                <>
                  <h3 className="text-sm font-semibold text-ink">{t('portal.workAbroad.share.consentTitle')}</h3>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-ink/70">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <li key={n}>{t(`portal.workAbroad.share.consent${n}`)}</li>
                    ))}
                  </ul>
                  <label className="mt-3 flex items-start gap-2.5 text-sm font-medium text-ink">
                    <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-border text-brand focus:ring-brand" />
                    {t('portal.workAbroad.share.consentAgree')}
                  </label>
                </>
              )}
              <Button
                type="button"
                className="mt-4"
                disabled={(!hasConsent && !consent) || dirty || action.isPending}
                onClick={() => run({ kind: 'share', consentVersion: SHARED_PROFILE_CONSENT_VERSION }, t('portal.workAbroad.share.sharedNotice'))}
              >
                {settings.status === 'APPROVED' ? t('portal.workAbroad.share.resume') : t('portal.workAbroad.share.share')}
              </Button>
              {dirty && <p className="mt-2 text-xs text-ink/50">{t('portal.workAbroad.share.saveFirst')}</p>}
            </>
          ) : (
            <div className="space-y-3">
              {link && (
                <div>
                  <p className="text-xs font-medium text-ink/60">{t('portal.workAbroad.share.yourLink')}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-paper px-3 py-2 text-sm text-ink">{link}</code>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(link);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2500);
                        } catch {
                          /* the link is on screen to copy by hand */
                        }
                      }}
                    >
                      {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                      {copied ? t('talent.copied') : t('talent.copyLink')}
                    </Button>
                    {settings.isLive && (
                      <Link href={`/talent/${settings.slug}`} target="_blank" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:text-brand-dark">
                        <ExternalLink className="h-4 w-4" aria-hidden />
                        {t('portal.workAbroad.share.view')}
                      </Link>
                    )}
                  </div>
                  {!settings.isLive && <p className="mt-1 text-xs text-ink/50">{t('portal.workAbroad.share.linkNotLive')}</p>}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" disabled={action.isPending} onClick={() => run({ kind: 'unshare' }, t('portal.workAbroad.share.pausedNotice'))}>
                  <Pause className="h-4 w-4" aria-hidden />
                  {t('portal.workAbroad.share.pause')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={action.isPending}
                  onClick={() => window.confirm(t('portal.workAbroad.share.newLinkConfirm')) && run({ kind: 'newLink' }, t('portal.workAbroad.share.newLinkNotice'))}
                >
                  <Link2 className="h-4 w-4" aria-hidden />
                  {t('portal.workAbroad.share.newLink')}
                </Button>
              </div>
            </div>
          )}

          {settings.consentAcceptedAt && (
            <div className="mt-4 border-t border-border pt-3">
              <button
                type="button"
                disabled={action.isPending}
                onClick={() => window.confirm(t('portal.workAbroad.share.withdrawConfirm')) && run({ kind: 'withdrawConsent' }, t('portal.workAbroad.share.withdrawnNotice'))}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-ink/60 hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                {t('portal.workAbroad.share.withdraw')}
              </button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
