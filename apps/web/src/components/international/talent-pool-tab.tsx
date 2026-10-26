'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { COUNTRY_CODES } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useTalentPool } from '@/lib/hooks/use-international';
import { Input, Select } from '@/components/ui/input';
import { countryName } from './shared';
import { ReadinessBar } from './readiness-bar';

/**
 * Every listed caregiver who has said they are open to working abroad, most
 * ready first. Staff work from here when shortlisting for an employer - only
 * those with a live shared profile can be put forward.
 */
export function TalentPoolTab() {
  const { t, locale } = useTranslation();
  const [country, setCountry] = useState('');
  const [minReady, setMinReady] = useState(0);
  const [search, setSearch] = useState('');
  const { data = [], isLoading } = useTalentPool({ country: country || undefined, minReady, search: search.trim() || undefined });
  const countries = [...COUNTRY_CODES].filter((c) => c !== 'LK').map((code) => ({ code, name: countryName(code, locale) })).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <p className="mb-4 max-w-3xl text-sm text-ink/60">{t('international.pool.hint')}</p>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
          <Input placeholder={t('international.pool.search')} className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select className="sm:w-56" value={country} onChange={(e) => setCountry(e.target.value)} aria-label={t('international.pool.country')}>
          <option value="">{t('international.pool.anyCountry')}</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select className="sm:w-44" value={String(minReady)} onChange={(e) => setMinReady(Number(e.target.value))} aria-label={t('international.pool.minReady')}>
          {[0, 3, 5, 7].map((n) => (
            <option key={n} value={n}>
              {n === 0 ? t('international.pool.anyReadiness') : t('international.pool.atLeast', { count: n })}
            </option>
          ))}
        </Select>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-border bg-paper text-xs uppercase tracking-wide text-ink/50">
            <tr>
              <th className="px-4 py-3 font-medium">{t('international.pool.caregiver')}</th>
              <th className="px-4 py-3 font-medium">{t('international.pool.countries')}</th>
              <th className="px-4 py-3 font-medium">{t('international.pool.available')}</th>
              <th className="px-4 py-3 font-medium">{t('international.pool.readiness')}</th>
              <th className="px-4 py-3 font-medium">{t('international.pool.profile')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink/50">
                  {t('common.loading')}
                </td>
              </tr>
            )}
            {!isLoading && data.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink/50">
                  {t('international.pool.empty')}
                </td>
              </tr>
            )}
            {data.map((r) => (
              <tr key={r.caregiverId} className="border-b border-border last:border-0 hover:bg-paper">
                <td className="px-4 py-3">
                  <Link href={`/caregivers/${r.caregiverId}`} className="font-medium text-brand-dark hover:underline">
                    {r.fullName}
                  </Link>
                  <div className="text-xs tabular-nums text-ink/50">
                    {r.registrationNumber}
                    {r.city && ` · ${r.city}`}
                  </div>
                </td>
                <td className="px-4 py-3 text-ink/80">{r.targetCountries.map((c) => countryName(c, locale)).join(', ') || '—'}</td>
                <td className="px-4 py-3 text-ink/70">{r.availableFrom ?? '—'}</td>
                <td className="px-4 py-3">
                  <ReadinessBar report={r.readiness} />
                </td>
                <td className="px-4 py-3">
                  {r.profileLive && r.talentSlug ? (
                    <a href={`/talent/${r.talentSlug}`} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-dark hover:underline">
                      {t('international.pool.live')}
                    </a>
                  ) : (
                    <span className="text-xs text-ink/40">{t('international.pool.notShared')}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
