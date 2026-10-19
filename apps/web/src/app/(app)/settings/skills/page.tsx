'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useSkills } from '@/lib/hooks/use-caregivers';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function SkillsPage() {
  const { t } = useTranslation();
  // Everyone in the staff app can see the list; only admins can add (the API agrees).
  const isAdmin = useAuth().user?.role === 'ADMIN';
  const { data: skills, isLoading } = useSkills();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', category: '' });

  const createMutation = useMutation({
    mutationFn: () => api.post('/skills', form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      setForm({ name: '', category: '' });
    },
  });

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-ink">{t('nav.skills')}</h2>
      <div className={isAdmin ? 'grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]' : 'max-w-2xl'}>
        <Card>
          <CardContent className="divide-y divide-border py-0">
            {isLoading && <p className="py-5 text-sm text-ink/50">{t('common.loading')}</p>}
            {skills?.map((s) => (
              <div key={s.id} className="flex items-center justify-between py-3 first:pt-5 last:pb-5">
                <span className="text-sm text-ink">{s.name}</span>
                <span className="text-xs text-ink/40">{s.category}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        {isAdmin && (
          <Card>
            <CardContent className="space-y-3 py-5">
              <div>
                <Label>Skill name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>Category</Label>
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </div>
              <Button className="w-full" disabled={!form.name || createMutation.isPending} onClick={() => createMutation.mutate()}>
                {t('common.add')}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
