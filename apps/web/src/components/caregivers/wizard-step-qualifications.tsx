'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Qualification } from '@/lib/api/types';
import { Input, Label, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';

const QUALIFICATION_TYPES = ['NVQ', 'NURSING_DIPLOMA', 'NURSING_DEGREE', 'CAREGIVER_CERTIFICATE', 'FIRST_AID', 'OTHER'];

export function QualificationsStep({ caregiverId, onNext, onBack }: { caregiverId: string; onNext: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', type: 'NVQ', institution: '', certificateNumber: '', issueDate: '' });

  const { data: qualifications, isLoading } = useQuery({
    queryKey: ['qualifications', caregiverId],
    queryFn: () => api.get<Qualification[]>(`/caregivers/${caregiverId}/qualifications`),
  });

  const addMutation = useMutation({
    mutationFn: (payload: typeof form) => api.post(`/caregivers/${caregiverId}/qualifications`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qualifications', caregiverId] });
      setForm({ name: '', type: 'NVQ', institution: '', certificateNumber: '', issueDate: '' });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/caregivers/${caregiverId}/qualifications/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['qualifications', caregiverId] }),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {isLoading && <p className="text-sm text-ink/50">{t('common.loading')}</p>}
        {qualifications?.map((q) => (
          <div key={q.id} className="flex items-center justify-between rounded border border-border px-4 py-3">
            <div>
              <div className="text-sm font-medium text-ink">{q.name}</div>
              <div className="text-xs text-ink/50">
                {q.type.replace('_', ' ')} · {q.institution}
              </div>
            </div>
            <button onClick={() => removeMutation.mutate(q.id)} className="text-ink/40 hover:text-danger">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        {qualifications?.length === 0 && <p className="text-sm text-ink/40">{t('caregivers.me.qualifications.noQualificationsYet')}</p>}
      </div>

      <div className="rounded border border-dashed border-border p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>{t('caregivers.me.qualifications.qualificationName')}</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label>{t('caregivers.me.qualifications.type')}</Label>
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {QUALIFICATION_TYPES.map((tp) => (
                <option key={tp} value={tp}>
                  {tp.replace('_', ' ')}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>{t('caregivers.me.qualifications.institution')}</Label>
            <Input value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} />
          </div>
          <div>
            <Label>{t('caregivers.me.qualifications.certificateNumber')}</Label>
            <Input value={form.certificateNumber} onChange={(e) => setForm({ ...form, certificateNumber: e.target.value })} />
          </div>
          <div>
            <Label>{t('caregivers.me.qualifications.issueDate')}</Label>
            <Input type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} />
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-3"
          disabled={!form.name || !form.institution || addMutation.isPending}
          onClick={() => addMutation.mutate(form)}
        >
          {t('caregivers.edit.addQualification')}
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