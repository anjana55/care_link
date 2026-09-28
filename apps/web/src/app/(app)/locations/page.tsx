'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useLocations } from '@/lib/hooks/use-caregivers';
import { useTranslation } from '@/lib/i18n/provider';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function LocationsPage() {
  const { t } = useTranslation();
  const { data: locations, isLoading } = useLocations();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ district: '', city: '', province: '' });

  const createMutation = useMutation({
    mutationFn: () => api.post('/locations', form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      setForm({ district: '', city: '', province: '' });
    },
  });

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-ink">{t('nav.locations')}</h1>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardContent className="divide-y divide-border py-0">
            {isLoading && <p className="py-5 text-sm text-ink/50">{t('common.loading')}</p>}
            {locations?.map((l) => (
              <div key={l.id} className="flex items-center justify-between py-3 first:pt-5 last:pb-5">
                <span className="text-sm text-ink">
                  {l.city}, {l.district}
                </span>
                <span className="text-xs text-ink/40">{l.province}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 py-5">
            <div>
              <Label>District</Label>
              <Input value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} />
            </div>
            <div>
              <Label>City / town</Label>
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div>
              <Label>Province</Label>
              <Input value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} />
            </div>
            <Button
              className="w-full"
              disabled={!form.district || !form.city || !form.province || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {t('common.add')}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
