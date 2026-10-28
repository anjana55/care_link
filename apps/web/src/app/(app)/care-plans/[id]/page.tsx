'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, ChevronLeft } from 'lucide-react';
import { careTypeValues, type CareType, type Locale } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { ApiError } from '@/lib/api/client';
import { useCarePlanTemplate, useCreateCarePlanTemplate, useSetCarePlanTemplateStatus, useUpdateCarePlanTemplate } from '@/lib/hooks/use-care-plans';
import { ActivityEditor, draftProblems, fromDraft, toDraft, type DraftActivity } from '@/components/care-plans/activity-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';

/** Create (`/care-plans/new`) or edit one care plan template. */
export default function CarePlanTemplatePage() {
  const { t, locale } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const router = useRouter();
  const { user, loading } = useAuth();
  const allowed = user?.role === 'ADMIN' || user?.role === 'STAFF';
  const { data, isLoading, isError } = useCarePlanTemplate(isNew ? '' : id);
  const create = useCreateCarePlanTemplate();
  const update = useUpdateCarePlanTemplate(id);
  const setStatus = useSetCarePlanTemplateStatus(id);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [careTypes, setCareTypes] = useState<CareType[]>([]);
  const [activities, setActivities] = useState<DraftActivity[]>([]);
  const [textLocale, setTextLocale] = useState<Locale>(locale);
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!loading && user && !allowed) router.replace('/dashboard');
  }, [loading, user, allowed, router]);

  useEffect(() => {
    if (!data) return;
    setName(data.name);
    setDescription(data.description ?? '');
    setCareTypes(data.careTypes);
    setActivities(data.activities.map(toDraft));
  }, [data]);

  if (loading || !allowed || (!isNew && isLoading)) return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;
  if (!isNew && (isError || !data)) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-ink/60">
        <span>{t('carePlans.templates.notFound')}</span>
        <Link href="/care-plans" className="text-brand-dark hover:underline">
          {t('carePlans.templates.back')}
        </Link>
      </div>
    );
  }

  const problems = draftProblems(activities);
  const nameMissing = name.trim().length < 2;
  const archived = data?.status === 'ARCHIVED';
  const pending = create.isPending || update.isPending;
  const err = create.error ?? update.error ?? setStatus.error;

  const save = () => {
    setTouched(true);
    setSaved(false);
    if (nameMissing || Object.keys(problems).length) return;
    const body = { name: name.trim(), description: description.trim() || null, careTypes, activities: activities.map(fromDraft).map(({ id: _id, ...a }) => a) };
    if (isNew) create.mutate(body, { onSuccess: (tpl) => router.replace(`/care-plans/${tpl.id}`) });
    else update.mutate(body, { onSuccess: () => setSaved(true) });
  };

  return (
    <div className="max-w-4xl">
      <Link href="/care-plans" className="mb-4 inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
        <ChevronLeft size={16} />
        {t('carePlans.templates.back')}
      </Link>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">{isNew ? t('carePlans.templates.new') : data!.name}</h1>
          <p className="mt-1 text-sm text-ink/60">{t('carePlans.templates.editHint')}</p>
        </div>
        {!isNew && user?.role === 'ADMIN' && (
          <Button variant="secondary" disabled={setStatus.isPending} onClick={() => setStatus.mutate(archived ? 'ACTIVE' : 'ARCHIVED')}>
            {archived ? <ArchiveRestore size={14} aria-hidden /> : <Archive size={14} aria-hidden />}
            {archived ? t('carePlans.templates.restore') : t('carePlans.templates.archive')}
          </Button>
        )}
      </div>
      {archived && <p className="mb-4 rounded bg-ink/5 px-3 py-2 text-sm text-ink/70">{t('carePlans.templates.archivedBanner')}</p>}

      <Card className="mb-4">
        <CardContent className="space-y-4 pt-5">
          <div>
            <Label htmlFor="tplName" required>
              {t('carePlans.templates.name')}
            </Label>
            <Input id="tplName" value={name} maxLength={150} onChange={(e) => setName(e.target.value)} placeholder={t('carePlans.templates.namePlaceholder')} />
            {touched && nameMissing && <p className="mt-1 text-xs text-danger">{t('carePlans.templates.nameRequired')}</p>}
          </div>
          <div>
            <Label htmlFor="tplDesc">{t('carePlans.templates.description')}</Label>
            <Textarea id="tplDesc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink">{t('carePlans.templates.careTypes')}</legend>
            <p className="mb-2 text-xs text-ink/50">{t('carePlans.templates.careTypesHint')}</p>
            <div className="flex flex-wrap gap-3">
              {careTypeValues.map((ct) => (
                <label key={ct} className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border text-brand focus:ring-brand"
                    checked={careTypes.includes(ct)}
                    onChange={(e) => setCareTypes(e.target.checked ? careTypeValues.filter((v) => v === ct || careTypes.includes(v)) : careTypes.filter((v) => v !== ct))}
                  />
                  {t(`careTypes.${ct}`)}
                </label>
              ))}
            </div>
          </fieldset>
        </CardContent>
      </Card>

      <h2 className="mb-2 text-base font-semibold text-ink">{t('carePlans.editor.activities')}</h2>
      <ActivityEditor value={activities} onChange={setActivities} textLocale={textLocale} onTextLocaleChange={setTextLocale} problems={touched ? problems : {}} />

      <div className="sticky bottom-0 mt-6 flex items-center gap-3 border-t border-border bg-paper/95 py-3">
        <Button disabled={pending} onClick={save}>
          {pending ? t('common.loading') : isNew ? t('carePlans.templates.create') : t('common.save')}
        </Button>
        {saved && <span role="status" className="text-sm text-brand-dark">{t('carePlans.saved')}</span>}
        {err && (
          <span role="alert" className="text-sm text-danger">
            {err instanceof ApiError && err.message ? err.message : t('requests.detail.saveFailed')}
          </span>
        )}
      </div>
    </div>
  );
}
