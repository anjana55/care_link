'use client';

import { Suspense, useEffect, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { REFERENCE_COMMENT_MAX, REFERENCE_TRUST, REFERENCE_YEARS, type ReferenceCheck, type ReferenceTrust, type ReferenceYears } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { api, ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Label, Textarea } from '@/components/ui/input';

type State = { status: 'checking' } | { status: 'invalid' } | { status: 'ready'; check: ReferenceCheck } | { status: 'done' };

function Choice<V extends string>({ name, legend, values, value, label, onChange }: { name: string; legend: string; values: readonly V[]; value: V | null; label: (v: V) => string; onChange: (v: V) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {values.map((v) => (
          <label key={v} className={`cursor-pointer rounded-DEFAULT border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-brand/40 ${value === v ? 'border-brand bg-brand-light text-brand-dark' : 'border-border text-ink/80'}`}>
            <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} className="sr-only" />
            {label(v)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Opened from the message a caregiver's referee was sent: three questions,
 * once. It shows only who is asking about whom; the answer goes to the
 * office's verification file and staff decide.
 */
function ReferenceInner() {
  const { t } = useTranslation();
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<State>({ status: 'checking' });
  const [knows, setKnows] = useState<'YES' | 'NO' | null>(null);
  const [years, setYears] = useState<ReferenceYears | null>(null);
  const [trust, setTrust] = useState<ReferenceTrust | null>(null);
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read from the address bar directly, so the token is never rendered into the page.
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('token') ?? '';
    setToken(value);
    if (!value) {
      setState({ status: 'invalid' });
      return;
    }
    api
      .post<ReferenceCheck>('/public/references/check', { token: value })
      .then((check) => setState(check.answered ? { status: 'done' } : { status: 'ready', check }))
      .catch(() => setState({ status: 'invalid' }));
  }, []);

  const complete = knows === 'NO' || (knows === 'YES' && years && trust);
  const submit = async () => {
    if (!token || !complete) return;
    setPending(true);
    setError(null);
    try {
      await api.post('/public/references/answer', {
        token,
        knowsThem: knows === 'YES',
        ...(knows === 'YES' ? { years, wouldTrust: trust } : {}),
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      setState({ status: 'done' });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setState({ status: 'done' });
      else if (err instanceof ApiError && err.status === 404) setState({ status: 'invalid' });
      else setError(err instanceof ApiError && err.message ? err.message : t('reference.error'));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader maxWidth="sm" />
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-lg border border-border bg-white p-8">
          {state.status === 'checking' && <p className="text-center text-sm text-ink/60">{t('common.loading')}</p>}

          {state.status === 'invalid' && (
            <div className="text-center">
              <XCircle size={40} className="mx-auto mb-4 text-danger" aria-hidden />
              <h1 className="mb-2 text-lg font-semibold text-ink">{t('reference.invalidTitle')}</h1>
              <p className="text-sm text-ink/60">{t('reference.invalidBody')}</p>
            </div>
          )}

          {state.status === 'done' && (
            <div className="text-center">
              <CheckCircle2 size={40} className="mx-auto mb-4 text-brand" aria-hidden />
              <h1 className="mb-2 text-lg font-semibold text-ink">{t('reference.doneTitle')}</h1>
              <p className="text-sm text-ink/60">{t('reference.doneBody')}</p>
            </div>
          )}

          {state.status === 'ready' && (
            <>
              <h1 className="text-lg font-semibold text-ink">{t('reference.title', { name: state.check.refereeName })}</h1>
              <p className="mt-1 text-sm text-ink/60">{t('reference.intro', { caregiver: state.check.caregiverName })}</p>
              <form
                className="mt-6 space-y-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <Choice
                  name="knows"
                  legend={t('reference.knows', { caregiver: state.check.caregiverName, relationship: state.check.relationship })}
                  values={['YES', 'NO'] as const}
                  value={knows}
                  label={(v) => t(`reference.yesNo.${v}`)}
                  onChange={setKnows}
                />
                {knows === 'YES' && (
                  <>
                    <Choice name="years" legend={t('reference.years')} values={REFERENCE_YEARS} value={years} label={(v) => t(`reference.yearsOptions.${v}`)} onChange={setYears} />
                    <Choice name="trust" legend={t('reference.trust')} values={REFERENCE_TRUST} value={trust} label={(v) => t(`reference.trustOptions.${v}`)} onChange={setTrust} />
                  </>
                )}
                <div>
                  <Label htmlFor="reference-comment">{t('reference.comment')}</Label>
                  <Textarea id="reference-comment" rows={3} maxLength={REFERENCE_COMMENT_MAX} value={comment} onChange={(e) => setComment(e.target.value)} />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-danger">
                    {error}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={!complete || pending}>
                  {pending ? t('common.loading') : t('reference.send')}
                </Button>
                <p className="text-center text-xs text-ink/50">{t('reference.privacy')}</p>
              </form>
            </>
          )}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

export default function ReferencePage() {
  return (
    <Suspense fallback={null}>
      <ReferenceInner />
    </Suspense>
  );
}
