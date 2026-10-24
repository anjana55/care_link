'use client';

import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { BankAccount } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { useBankAccounts, useDeleteBankAccount, useSaveBankAccount } from '@/lib/hooks/use-billing';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

type Draft = { id?: string; bankName: string; branch: string; accountName: string; accountNumber: string; active: boolean };
const EMPTY: Draft = { bankName: '', branch: '', accountName: '', accountNumber: '', active: true };

/**
 * Settings > Billing > Bank accounts. The business's own accounts, picked
 * when a payment in (from a client) or out (to a caregiver) is made by bank.
 * An account with payments against it can only be turned off, not deleted,
 * so past payments keep naming it.
 */
export function BankAccountsCard() {
  const { t } = useTranslation();
  const { data: accounts = [], isLoading } = useBankAccounts();
  const save = useSaveBankAccount();
  const remove = useDeleteBankAccount();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<BankAccount | null>(null);
  const apiError = (e: unknown) => (e instanceof ApiError && e.message ? e.message : t('common.actionFailed'));

  const submit = () => {
    if (!draft) return;
    const { id, ...v } = draft;
    save.mutate({ id, ...v, branch: v.branch.trim() }, { onSuccess: () => setDraft(null) });
  };
  const canSave = draft && draft.bankName.trim() && draft.accountName.trim() && draft.accountNumber.trim();

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle>{t('billingAdmin.bankAccounts.title')}</CardTitle>
        {!draft && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              save.reset();
              setDraft(EMPTY);
            }}
          >
            <Plus size={14} className="mr-1" aria-hidden />
            {t('billingAdmin.bankAccounts.add')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-ink/60">{t('billingAdmin.bankAccounts.hint')}</p>
        {isLoading && <p className="text-sm text-ink/50">{t('common.loading')}</p>}
        {!isLoading && accounts.length === 0 && !draft && <p className="text-sm text-ink/50">{t('billingAdmin.bankAccounts.empty')}</p>}

        {accounts.length > 0 && (
          <ul className="divide-y divide-border rounded border border-border">
            {accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {a.bankName}
                    {a.branch && <span className="font-normal text-ink/60"> · {a.branch}</span>}
                    {!a.active && (
                      <span className="ml-2 rounded bg-paper px-1.5 py-0.5 text-xs font-normal text-ink/60">{t('billingAdmin.bankAccounts.inactive')}</span>
                    )}
                  </p>
                  <p className="text-xs tabular-nums text-ink/60">
                    {a.accountNumber} · {a.accountName}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={t('billingAdmin.bankAccounts.edit', { name: a.bankName })}
                    onClick={() => {
                      save.reset();
                      setDraft({ id: a.id, bankName: a.bankName, branch: a.branch ?? '', accountName: a.accountName, accountNumber: a.accountNumber, active: a.active });
                    }}
                  >
                    <Pencil size={14} aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={t('billingAdmin.bankAccounts.delete', { name: a.bankName })}
                    onClick={() => {
                      remove.reset();
                      setDeleting(a);
                    }}
                  >
                    <Trash2 size={14} aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {draft && (
          <form
            className="grid gap-3 rounded border border-border bg-paper p-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSave) submit();
            }}
          >
            <div>
              <Label htmlFor="ba-bank" required>
                {t('billingAdmin.bankAccounts.bankName')}
              </Label>
              <Input id="ba-bank" value={draft.bankName} maxLength={120} onChange={(e) => setDraft({ ...draft, bankName: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="ba-branch">{t('billingAdmin.bankAccounts.branch')}</Label>
              <Input id="ba-branch" value={draft.branch} maxLength={120} onChange={(e) => setDraft({ ...draft, branch: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="ba-name" required>
                {t('billingAdmin.bankAccounts.accountName')}
              </Label>
              <Input id="ba-name" value={draft.accountName} maxLength={200} onChange={(e) => setDraft({ ...draft, accountName: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="ba-number" required>
                {t('billingAdmin.bankAccounts.accountNumber')}
              </Label>
              <Input id="ba-number" value={draft.accountNumber} maxLength={40} onChange={(e) => setDraft({ ...draft, accountNumber: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                className="h-4 w-4 rounded border-border text-brand focus:ring-brand"
              />
              {t('billingAdmin.bankAccounts.activeLabel')}
            </label>
            {save.isError && (
              <p role="alert" className="text-sm text-danger sm:col-span-2">
                {apiError(save.error)}
              </p>
            )}
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="sm" disabled={!canSave || save.isPending}>
                {save.isPending ? t('common.loading') : t('common.save')}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setDraft(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        )}
      </CardContent>

      {deleting && (
        <ConfirmDialog
          title={t('billingAdmin.bankAccounts.deleteTitle')}
          message={t('billingAdmin.bankAccounts.deleteMessage', { name: `${deleting.bankName} - ${deleting.accountNumber}` })}
          confirmLabel={t('common.delete')}
          tone="danger"
          pending={remove.isPending}
          error={remove.isError ? apiError(remove.error) : null}
          onConfirm={() => remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
          onCancel={() => setDeleting(null)}
        />
      )}
    </Card>
  );
}
