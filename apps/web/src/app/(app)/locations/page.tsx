'use client';

import { useMemo, useState } from 'react';
import { useLocationTree, useCitiesPage } from '@/lib/hooks/use-caregivers';
import { useTranslation } from '@/lib/i18n/provider';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';

/**
 * Read-only browser for Sri Lanka's administrative divisions.
 *
 * There is no add form here any more, deliberately. The districts and cities
 * of a country are reference data loaded from CSV, not something an admin
 * types in: the old hand-add form was how the old table ended up with 2140
 * rows that were near-duplicates of each other. `POST /locations` is gone
 * from the API to match.
 *
 * Cities are paginated server-side rather than fetched whole. Colombo alone
 * has 164 of them and the country has 2155; handing the browser all of them
 * to filter client-side would make this page the slowest one in the app.
 */
export default function LocationsPage() {
  const { t } = useTranslation();
  const { data: tree, isLoading: treeLoading } = useLocationTree();
  const [provinceId, setProvinceId] = useState<number | ''>('');
  const [districtId, setDistrictId] = useState<number | ''>('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const districts = useMemo(() => {
    const all = (tree ?? []).flatMap((p) => p.districts);
    return provinceId === '' ? all : all.filter((d) => (tree ?? []).find((p) => p.id === provinceId)?.districts.some((x) => x.id === d.id));
  }, [tree, provinceId]);

  const { data: pageData, isLoading: citiesLoading } = useCitiesPage({
    districtId: districtId === '' ? undefined : districtId,
    q: query.trim() || undefined,
    page,
  });

  const totalPages = pageData ? Math.max(1, Math.ceil(pageData.total / pageData.pageSize)) : 1;

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-ink">{t('nav.locations')}</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardContent className="py-5">
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div className="min-w-40">
                <Label htmlFor="province">Province</Label>
                <Select
                  id="province"
                  value={provinceId}
                  onChange={(e) => {
                    const next = e.target.value === '' ? '' : Number(e.target.value);
                    // The district list is scoped to the province, so a stale
                    // district from the previous one would filter to nothing.
                    setProvinceId(next);
                    setDistrictId('');
                    setPage(1);
                  }}
                >
                  <option value="">All provinces</option>
                  {(tree ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="min-w-40">
                <Label htmlFor="district">District</Label>
                <Select
                  id="district"
                  value={districtId}
                  onChange={(e) => {
                    setDistrictId(e.target.value === '' ? '' : Number(e.target.value));
                    setPage(1);
                  }}
                >
                  <option value="">All districts</option>
                  {districts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="min-w-48 flex-1">
                <Label htmlFor="city-search">Search cities</Label>
                <Input
                  id="city-search"
                  value={query}
                  placeholder="Name, sub-name or postcode"
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
            </div>

            {citiesLoading && <p className="text-sm text-ink/50">{t('common.loading')}</p>}

            {!citiesLoading && pageData && pageData.items.length === 0 && (
              <p className="text-sm text-ink/50">No cities match those filters.</p>
            )}

            <div className="divide-y divide-border">
              {pageData?.items.map((c) => (
                <div key={c.id} className="flex items-baseline justify-between gap-4 py-2.5">
                  <span className="text-sm text-ink">
                    {c.name}
                    {c.subName && <span className="text-ink/50"> &mdash; {c.subName}</span>}
                  </span>
                  {/* A string, and it may be absent: 47 of the real postcodes
                      keep a leading zero and 101 cities have none at all. */}
                  <span className="shrink-0 text-xs tabular-nums text-ink/40">{c.postcode ?? '—'}</span>
                </div>
              ))}
            </div>

            {pageData && pageData.total > pageData.pageSize && (
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-ink/50">
                  Page {pageData.page} of {totalPages} &middot; {pageData.total} cities
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    className="rounded border border-border px-3 py-1 disabled:opacity-40"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border px-3 py-1 disabled:opacity-40"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </button>
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 py-5 text-sm text-ink/70">
            <p className="font-medium text-ink">Reference data</p>
            <p>
              Provinces, districts and cities are loaded from the official CSV set and are not edited
              here. Their English, Sinhala and Tamil names, coordinates and postcodes all come from
              that source, so the caregiver registration dropdowns and the public search filters
              read from the same rows.
            </p>
            {treeLoading ? (
              <p className="text-xs text-ink/40">{t('common.loading')}</p>
            ) : (
              <p className="text-xs text-ink/40">
                {(tree ?? []).length} provinces &middot;{' '}
                {(tree ?? []).reduce((n, p) => n + p.districts.length, 0)} districts &middot;{' '}
                {pageData?.total ?? 0} cities shown
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}