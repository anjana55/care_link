'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useLanguages } from '@/lib/hooks/use-caregivers';
import { Select, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';

interface AssignedLanguage {
  languageId: string;
  name: string;
  proficiency: string;
}

const PROFICIENCIES = ['BASIC', 'CONVERSATIONAL', 'FLUENT', 'NATIVE'];

export function LanguagesStep({ caregiverId, onNext, onBack }: { caregiverId: string; onNext: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: allLanguages } = useLanguages();
  const [languageId, setLanguageId] = useState('');
  const [proficiency, setProficiency] = useState('FLUENT');

  const { data: assigned, isLoading } = useQuery({
    queryKey: ['caregiver-languages', caregiverId],
    queryFn: () => api.get<AssignedLanguage[]>(`/caregivers/${caregiverId}/languages`),
  });

  const assignMutation = useMutation({
    mutationFn: () => api.post(`/caregivers/${caregiverId}/languages`, { languageId, proficiency }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caregiver-languages', caregiverId] });
      setLanguageId('');
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/caregivers/${caregiverId}/languages/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['caregiver-languages', caregiverId] }),
  });

  const availableLanguages = allLanguages?.filter((l) => !assigned?.some((a) => a.languageId === l.id)) ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {isLoading && <p className="text-sm text-ink/50">{t('common.loading')}</p>}
        {assigned?.map((l) => (
          <div key={l.languageId} className="flex items-center justify-between rounded border border-border px-4 py-2.5">
            <div className="text-sm text-ink">
              {l.name} <span className="text-ink/40">· {l.proficiency}</span>
            </div>
            <button onClick={() => removeMutation.mutate(l.languageId)} className="text-ink/40 hover:text-danger">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {assigned?.length === 0 && <p className="text-sm text-ink/40">{t('caregivers.me.languages.noLanguagesYet')}</p>}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded border border-dashed border-border p-4">
        <div className="min-w-[200px] flex-1">
          <Label>{t('caregivers.me.languages.language')}</Label>
          <Select value={languageId} onChange={(e) => setLanguageId(e.target.value)}>
            <option value="">Select a language</option>
            {availableLanguages.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <Label>{t('caregivers.me.languages.proficiency')}</Label>
          <Select value={proficiency} onChange={(e) => setProficiency(e.target.value)}>
            {PROFICIENCIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </div>
        <Button type="button" variant="secondary" disabled={!languageId || assignMutation.isPending} onClick={() => assignMutation.mutate()}>
          {t('caregivers.edit.addLanguage')}
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