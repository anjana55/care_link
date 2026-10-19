'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy } from 'lucide-react';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { useBillingSettings, useUpdateBillingSettings } from '@/lib/hooks/use-billing';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import type { BillingSettings } from '@/lib/api/types';

type Draft = {
  businessName: string;
  businessAddress: string;
  businessPhone: string;
  businessEmail: string;
  registrationNumber: string;
  taxEnabled: boolean;
  taxName: string;
  taxRate: string;
  taxRegistrationNumber: string;
  invoicePrefix: string;
  nextInvoiceNumber: number;
  paymentTermsDays: number;
  invoiceFooter: string;
  payhereEnabled: boolean;
  payhereMode: 'SANDBOX' | 'LIVE';
  payhereMerchantId: string;
  payhereMerchantSecret: string;
  clearPayhereMerchantSecret: boolean;
  payhereNotifyBaseUrl: string;
};

function toDraft(s: BillingSettings): Draft {
  return {
    businessName: s.businessName,
    businessAddress: s.businessAddress ?? '',
    businessPhone: s.businessPhone ?? '',
    businessEmail: s.businessEmail ?? '',
    registrationNumber: s.registrationNumber ?? '',
    taxEnabled: s.taxEnabled,
    taxName: s.taxName,
    taxRate: String(Number(s.taxRate)),
    taxRegistrationNumber: s.taxRegistrationNumber ?? '',
    invoicePrefix: s.invoicePrefix,
    nextInvoiceNumber: s.nextInvoiceNumber,
    paymentTermsDays: s.paymentTermsDays,
    invoiceFooter: s.invoiceFooter ?? '',
    payhereEnabled: s.payhereEnabled,
    payhereMode: s.payhereMode,
    payhereMerchantId: s.payhereMerchantId ?? '',
    payhereMerchantSecret: '',
    clearPayhereMerchantSecret: false,
    payhereNotifyBaseUrl: s.payhereNotifyBaseUrl ?? '',
  };
}

/**
 * Settings > Billing (admin): who invoices are from, tax, numbering, and the
 * PayHere merchant for online payment. Same pattern as Email and WhatsApp:
 * read on every use, so a change - or switching online payment off - applies
 * at once, and the merchant secret is write-only.
 */
export default function BillingSettingsPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { data: settings, isLoading } = useBillingSettings();
  const save = useUpdateBillingSettings();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (user && user.role !== 'ADMIN') router.replace('/dashboard');
  }, [authLoading, user, router]);

  useEffect(() => {
    if (settings) setDraft(toDraft(settings));
  }, [settings]);

  if (authLoading || !user || user.role !== 'ADMIN' || isLoading || !draft || !settings) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setSaved(false);
    setDraft({ ...draft, [key]: value });
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(settings));
  const submit = () => {
    const { payhereMerchantSecret, clearPayhereMerchantSecret, ...rest } = draft;
    save.mutate(
      {
        ...rest,
        ...(payhereMerchantSecret.trim() ? { payhereMerchantSecret: payhereMerchantSecret.trim() } : {}),
        ...(clearPayhereMerchantSecret ? { clearPayhereMerchantSecret: true } : {}),
      },
      {
        onSuccess: () => {
          setSaved(true);
          setTimeout(() => setSaved(false), 3000);
        },
      },
    );
  };
  const exampleNumber = `${draft.invoicePrefix || 'INV'}-${String(draft.nextInvoiceNumber || 1).padStart(6, '0')}`;

  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('billingAdmin.businessTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <p className="text-sm text-ink/60 sm:col-span-2">{t('billingAdmin.businessHint')}</p>
          <div>
            <Label htmlFor="bName" required>{t('billingAdmin.businessName')}</Label>
            <Input id="bName" maxLength={200} value={draft.businessName} onChange={(e) => set('businessName', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="bReg">{t('billingAdmin.registrationNumber')}</Label>
            <Input id="bReg" maxLength={60} value={draft.registrationNumber} onChange={(e) => set('registrationNumber', e.target.value)} placeholder="PV 00000" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="bAddress">{t('billingAdmin.address')}</Label>
            <Textarea id="bAddress" rows={2} maxLength={500} value={draft.businessAddress} onChange={(e) => set('businessAddress', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="bPhone">{t('billingAdmin.phone')}</Label>
            <Input id="bPhone" maxLength={40} value={draft.businessPhone} onChange={(e) => set('businessPhone', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="bEmail">{t('billingAdmin.email')}</Label>
            <Input id="bEmail" type="email" maxLength={255} value={draft.businessEmail} onChange={(e) => set('businessEmail', e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('billingAdmin.invoicesTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="prefix">{t('billingAdmin.prefix')}</Label>
            <Input id="prefix" maxLength={8} value={draft.invoicePrefix} onChange={(e) => set('invoicePrefix', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
          </div>
          <div>
            <Label htmlFor="nextNo">{t('billingAdmin.nextNumber')}</Label>
            <Input id="nextNo" type="number" min={settings.nextInvoiceNumber} value={draft.nextInvoiceNumber} onChange={(e) => set('nextInvoiceNumber', Number(e.target.value))} />
          </div>
          <div>
            <Label htmlFor="terms">{t('billingAdmin.terms')}</Label>
            <Input id="terms" type="number" min={0} max={120} value={draft.paymentTermsDays} onChange={(e) => set('paymentTermsDays', Number(e.target.value))} />
          </div>
          <p className="text-xs text-ink/50 sm:col-span-3">{t('billingAdmin.numberingHint', { example: exampleNumber })}</p>
          <div className="sm:col-span-3">
            <Label htmlFor="footer">{t('billingAdmin.footer')}</Label>
            <Textarea id="footer" rows={3} maxLength={2000} value={draft.invoiceFooter} onChange={(e) => set('invoiceFooter', e.target.value)} placeholder={t('billingAdmin.footerPlaceholder')} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('billingAdmin.taxTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={draft.taxEnabled} onChange={(e) => set('taxEnabled', e.target.checked)} />
            <span>
              <span className="font-medium text-ink">{t('billingAdmin.taxEnabled')}</span>
              <span className="block text-xs text-ink/50">{t('billingAdmin.taxHint')}</span>
            </span>
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="taxName">{t('billingAdmin.taxName')}</Label>
              <Input id="taxName" maxLength={40} value={draft.taxName} onChange={(e) => set('taxName', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="taxRate">{t('billingAdmin.taxRate')}</Label>
              <Input id="taxRate" inputMode="decimal" value={draft.taxRate} onChange={(e) => set('taxRate', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="taxReg">{t('billingAdmin.taxRegistration')}</Label>
              <Input id="taxReg" maxLength={60} value={draft.taxRegistrationNumber} onChange={(e) => set('taxRegistrationNumber', e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('billingAdmin.payhereTitle')}</CardTitle>
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${settings.payhereUsable ? 'bg-brand text-white' : 'bg-paper text-ink/60'}`}>
            {settings.payhereUsable ? t('billingAdmin.payhereOn', { mode: t(`billingAdmin.mode.${settings.payhereMode}`) }) : t('billingAdmin.payhereOff')}
          </span>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-ink/60">{t('billingAdmin.payhereHint')}</p>
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={draft.payhereEnabled} onChange={(e) => set('payhereEnabled', e.target.checked)} />
            <span className="font-medium text-ink">{t('billingAdmin.payhereEnabled')}</span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="phMode">{t('billingAdmin.mode.label')}</Label>
              <Select id="phMode" value={draft.payhereMode} onChange={(e) => set('payhereMode', e.target.value as 'SANDBOX' | 'LIVE')}>
                <option value="SANDBOX">{t('billingAdmin.mode.SANDBOX')}</option>
                <option value="LIVE">{t('billingAdmin.mode.LIVE')}</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="phMerchant">{t('billingAdmin.merchantId')}</Label>
              <Input id="phMerchant" inputMode="numeric" maxLength={40} value={draft.payhereMerchantId} onChange={(e) => set('payhereMerchantId', e.target.value.trim())} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="phSecret">{t('billingAdmin.merchantSecret')}</Label>
              <Input
                id="phSecret"
                type="password"
                autoComplete="off"
                maxLength={255}
                value={draft.payhereMerchantSecret}
                onChange={(e) => set('payhereMerchantSecret', e.target.value)}
                placeholder={settings.payhereMerchantSecretSet ? t('billingAdmin.secretStored', { last4: settings.payhereMerchantSecretLast4 ?? '' }) : t('billingAdmin.secretNone')}
              />
              {settings.payhereMerchantSecretSet && (
                <label className="mt-1 flex items-center gap-2 text-xs text-ink/60">
                  <input type="checkbox" className="accent-brand" checked={draft.clearPayhereMerchantSecret} onChange={(e) => set('clearPayhereMerchantSecret', e.target.checked)} />
                  {t('billingAdmin.clearSecret')}
                </label>
              )}
              <p className="mt-1 text-xs text-ink/50">{t('billingAdmin.secretHint')}</p>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="phNotify">{t('billingAdmin.notifyBase')}</Label>
              <Input id="phNotify" maxLength={255} value={draft.payhereNotifyBaseUrl} onChange={(e) => set('payhereNotifyBaseUrl', e.target.value)} placeholder="https://find.caregivers.lk/api" />
              <div className="mt-1 flex items-center gap-2 text-xs text-ink/50">
                <span>
                  {t('billingAdmin.notifyUrl')} <code className="rounded bg-paper px-1">{settings.payhereNotifyUrl}</code>
                </span>
                <button
                  type="button"
                  className="rounded p-1 hover:bg-paper hover:text-ink"
                  aria-label={t('billingAdmin.copy')}
                  onClick={() => {
                    void navigator.clipboard?.writeText(settings.payhereNotifyUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  <Copy size={12} />
                </button>
                {copied && <span className="text-brand-dark">{t('billingAdmin.copied')}</span>}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!dirty || save.isPending} onClick={submit}>
          {save.isPending ? t('common.loading') : t('common.save')}
        </Button>
        {saved && <span className="text-sm text-brand-dark">{t('billingAdmin.saved')}</span>}
        {save.isError && (
          <p role="alert" className="text-sm text-danger">
            {save.error instanceof ApiError && save.error.message ? save.error.message : t('emailAdmin.saveError')}
          </p>
        )}
      </div>
    </div>
  );
}
