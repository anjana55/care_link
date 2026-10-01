'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useSkills } from '@/lib/hooks/use-caregivers';
import { Select, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';

interface AssignedSkill {
  skillId: string;
  name: string;
  proficiency: string;
  yearsOfExperience: number | null;
}

const PROFICIENCIES = ['BASIC', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'];

export function SkillsStep({ caregiverId, onNext, onBack }: { caregiverId: string; onNext: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: allSkills } = useSkills();
  const [skillId, setSkillId] = useState('');
  const [proficiency, setProficiency] = useState('INTERMEDIATE');

  const { data: assigned, isLoading } = useQuery({
    queryKey: ['caregiver-skills', caregiverId],
    queryFn: () => api.get<AssignedSkill[]>(`/caregivers/${caregiverId}/skills`),
  });

  const assignMutation = useMutation({
    mutationFn: () => api.post(`/caregivers/${caregiverId}/skills`, { skillId, proficiency, yearsOfExperience: 1 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caregiver-skills', caregiverId] });
      setSkillId('');
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/caregivers/${caregiverId}/skills/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['caregiver-skills', caregiverId] }),
  });

  const availableSkills = allSkills?.filter((s) => !assigned?.some((a) => a.skillId === s.id)) ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {isLoading && <p className="text-sm text-ink/50">{t('common.loading')}</p>}
        {assigned?.map((s) => (
          <div key={s.skillId} className="flex items-center justify-between rounded border border-border px-4 py-2.5">
            <div className="text-sm text-ink">
              {s.name} <span className="text-ink/40">· {s.proficiency}</span>
            </div>
            <button onClick={() => removeMutation.mutate(s.skillId)} className="text-ink/40 hover:text-danger">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {assigned?.length === 0 && <p className="text-sm text-ink/40">{t('caregivers.me.skills.noSkillsYet')}</p>}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded border border-dashed border-border p-4">
        <div className="min-w-[200px] flex-1">
          <Label>{t('caregivers.me.skills.skill')}</Label>
          <Select value={skillId} onChange={(e) => setSkillId(e.target.value)}>
            <option value="">Select a skill</option>
            {availableSkills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <Label>{t('caregivers.me.skills.proficiency')}</Label>
          <Select value={proficiency} onChange={(e) => setProficiency(e.target.value)}>
            {PROFICIENCIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </div>
        <Button type="button" variant="secondary" disabled={!skillId || assignMutation.isPending} onClick={() => assignMutation.mutate()}>
          {t('caregivers.edit.addSkill')}
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