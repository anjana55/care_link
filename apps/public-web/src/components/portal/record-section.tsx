'use client';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea, FieldError } from '@/components/ui/input';
import { VerificationBadge, isWithdrawable } from './status-badge';
import type { VerificationStatus } from '@/lib/api/portal-types';

export interface FieldSpec {
  name: string;
  type: 'text' | 'date' | 'select' | 'textarea';
  required?: boolean;
  options?: readonly string[];
  /** i18n prefix for the option labels, e.g. `portal.qualifications.types` */
  optionLabelPrefix?: string;
  wide?: boolean;
}

type Row = { id: string; verificationStatus: VerificationStatus } & Record<string, unknown>;

/**
 * A small add / edit / withdraw list, used for qualifications and experience.
 *
 * Both are the same shape - a handful of fields per entry, each entry checked
 * by staff - so one component with a field list beats two near-copies. Editing a
 * checked entry sends it back to "pending" on the server, and the form says so
 * beforehand rather than leaving the caregiver to find a badge changed.
 */
export function RecordSection({
  i18n,
  rows,
  loading,
  fields,
  titleOf,
  detailOf,
  onSave,
  onRemove,
  saving,
}: {
  /** Prefix for this section's strings, e.g. `portal.qualifications` */
  i18n: string;
  rows: Row[] | undefined;
  loading: boolean;
  fields: FieldSpec[];
  titleOf: (row: Row) => string;
  detailOf: (row: Row) => string;
  onSave: (values: Record<string, unknown>, id?: string) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<{ id?: string; values: Record<string, string> } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const blank = () => Object.fromEntries(fields.map((f) => [f.name, f.type === 'select' ? f.options![0] : '']));
  const fromRow = (row: Row) => Object.fromEntries(fields.map((f) => [f.name, String(row[f.name] ?? '').slice(0, f.type === 'date' ? 10 : undefined)]));

  const start = (row?: Row) => {
    setErrors({});
    setServerError(null);
    setEditing(row ? { id: row.id, values: fromRow(row) } : { values: blank() });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const next: Record<string, string> = {};
    for (const f of fields) if (f.required && !editing.values[f.name].trim()) next[f.name] = t('portal.requiredField');
    setErrors(next);
    if (Object.keys(next).length) return;
    // Blank optional fields are left out: dates and numbers cannot be '' on the API.
    const body = Object.fromEntries(Object.entries(editing.values).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, v.trim()]));
    try {
      await onSave(body, editing.id);
      setEditing(null);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : t('portal.saveError'));
    }
  };

  const remove = async (row: Row) => {
    if (!window.confirm(t(`${i18n}.confirmRemove`))) return;
    setServerError(null);
    try {
      await onRemove(row.id);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : t('portal.saveError'));
    }
  };

  const editingVerified = editing?.id && rows?.find((r) => r.id === editing.id)?.verificationStatus === 'VERIFIED';

  return (
    <section className="rounded-lg border border-border bg-white p-5" aria-label={t(`${i18n}.title`)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{t(`${i18n}.title`)}</h2>
        {!editing && (
          <Button type="button" variant="secondary" size="sm" onClick={() => start()}>
            {t(`${i18n}.add`)}
          </Button>
        )}
      </div>

      {loading && <p className="text-sm text-ink/60">{t('common.loading')}</p>}
      {rows && rows.length === 0 && !editing && <p className="text-sm text-ink/60">{t(`${i18n}.none`)}</p>}

      <ul className="divide-y divide-border">
        {rows?.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{titleOf(row)}</p>
              <p className="truncate text-xs text-ink/50">{detailOf(row)}</p>
            </div>
            <div className="flex items-center gap-3">
              <VerificationBadge status={row.verificationStatus} />
              <button type="button" onClick={() => start(row)} className="text-sm font-medium text-brand-dark hover:underline">
                {t('portal.edit')}
                <span className="sr-only"> {titleOf(row)}</span>
              </button>
              {isWithdrawable(row.verificationStatus) && (
                <button type="button" onClick={() => remove(row)} className="text-sm text-danger hover:underline">
                  {t('portal.remove')}
                  <span className="sr-only"> {titleOf(row)}</span>
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {editing && (
        <form onSubmit={submit} className="mt-4 rounded border border-border bg-paper p-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((f) => {
              const id = `${i18n}-${f.name}`;
              const value = editing.values[f.name];
              const set = (v: string) => {
                setErrors((e) => ({ ...e, [f.name]: '' }));
                setEditing({ ...editing, values: { ...editing.values, [f.name]: v } });
              };
              return (
                <div key={f.name} className={f.wide || f.type === 'textarea' ? 'sm:col-span-2' : undefined}>
                  <Label htmlFor={id} required={f.required}>{t(`${i18n}.fields.${f.name}`)}</Label>
                  {f.type === 'select' ? (
                    <Select id={id} value={value} onChange={(e) => set(e.target.value)}>
                      {f.options!.map((o) => (
                        <option key={o} value={o}>{t(`${f.optionLabelPrefix}.${o}`)}</option>
                      ))}
                    </Select>
                  ) : f.type === 'textarea' ? (
                    <Textarea id={id} rows={3} value={value} onChange={(e) => set(e.target.value)} />
                  ) : (
                    <Input id={id} type={f.type} value={value} onChange={(e) => set(e.target.value)} />
                  )}
                  <FieldError message={errors[f.name] || undefined} />
                </div>
              );
            })}
          </div>
          {editingVerified && <p role="status" className="mt-3 text-xs text-amber-700">{t('portal.editResetsVerification')}</p>}
          {serverError && <p role="alert" className="mt-3 text-sm text-danger">{serverError}</p>}
          <div className="mt-4 flex gap-3">
            <Button type="submit" disabled={saving}>{saving ? t('common.loading') : t('common.save')}</Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
          </div>
        </form>
      )}
      {!editing && serverError && <p role="alert" className="mt-3 text-sm text-danger">{serverError}</p>}
    </section>
  );
}
