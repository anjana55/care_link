'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Experience } from '@/lib/api/types';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';

export function ExperienceStep({ caregiverId, onNext, onBack }: { caregiverId: string; onNext: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    employerOrClient: '',
    role: '',
    country: 'Sri Lanka',
    location: '',
    startDate: '',
    endDate: '',
    careType: '',
    description: '',
  });

  const { data: experiences, isLoading } = useQuery({
    queryKey: ['experiences', caregiverId],
    queryFn: () => api.get<Experience[]>(`/caregivers/${caregiverId}/experiences`),
  });

  const addMutation = useMutation({
    mutationFn: (payload: typeof form) => api.post(`/caregivers/${caregiverId}/experiences`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiences', caregiverId] });
      setForm({ employerOrClient: '', role: '', country: 'Sri Lanka', location: '', startDate: '', endDate: '', careType: '', description: '' });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/caregivers/${caregiverId}/experiences/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['experiences', caregiverId] }),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {isLoading && <p className="text-sm text-ink/50">{t('common.loading')}</p>}
        {experiences?.map((e) => (
          <div key={e.id} className="flex items-center justify-between rounded border border-border px-4 py-3">
            <div>
              <div className="text-sm font-medium text-ink">
                {e.role} · {e.employerOrClient}
              </div>
              <div className="text-xs text-ink/50">
                {e.country} · {e.startDate?.slice(0, 10)} — {e.endDate ? e.endDate.slice(0, 10) : t('caregivers.me.experience.present')}
              </div>
            </div>
            <button onClick={() => removeMutation.mutate(e.id)} className="text-ink/40 hover:text-danger">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        {experiences?.length === 0 && <p className="text-sm text-ink/40">{t('caregivers.me.experience.noExperienceYet')}</p>}
      </div>

      <div className="rounded border border-dashed border-border p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>{t('caregivers.me.experience.employerOrClient')}</Label>
            <Input value={form.employerOrClient} onChange={(e) => setForm({ ...form, employerOrClient: e.target.value })} />
          </div>
          <div>
            <Label>{t('caregivers.me.experience.role')}</Label>
            <Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
          </div>
          <div>
            <Label>{t('caregivers.me.experience.country')}</Label>
            <Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
          </div>
          <div>
            <Label>{t('caregivers.me.experience.location')}</Label>
            <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </div>
          <div>
            <Label>{t('caregivers.me.experience.startDate')}</Label>
            <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </div>
          <div>
            <Label>{t('caregivers.me.experience.endDate')}</Label>
            <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </div>
          <div>
            <Label>{t('caregivers.me.experience.careType')}</Label>
            <Input value={form.careType} onChange={(e) => setForm({ ...form, careType: e.target.value })} placeholder="e.g. elderly, post-surgical" />
          </div>
          <div className="sm:col-span-2">
            <Label>{t('caregivers.me.experience.description')}</Label>
            <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-3"
          disabled={!form.employerOrClient || !form.role || !form.startDate || addMutation.isPending}
          onClick={() => addMutation.mutate(form)}
        >
          {t('caregivers.edit.addExperience')}
        </Button>
      </div>

      <div className="flex justify-between border-t border-border pt-4">
        <Button type="button" variant="secondary" onClick={onBack}>
          {t('caregivers.wizard.back')}
        </Button>
        <Button type="button" onClick={onNext}>
          {t('caregivers.wizard.next')}
        </Button>
      </div>
    </div>
  );
}