'use client';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import type { StaffRole, StaffUser } from '@/lib/api/types';

const ROLES: StaffRole[] = ['ADMIN', 'STAFF', 'VERIFIER'];

export interface UserFormValues {
  fullName: string;
  email: string;
  password?: string;
  role: StaffRole;
}

interface Props {
  /** When present, the form edits this user (no password field); otherwise it creates a new one. */
  editing?: StaffUser | null;
  submitting?: boolean;
  error?: string | null;
  onSubmit: (values: UserFormValues) => void;
  onClose: () => void;
}

export function UserFormModal({ editing, submitting, error, onSubmit, onClose }: Props) {
  const { t } = useTranslation();
  const [fullName, setFullName] = useState(editing?.fullName ?? '');
  const [email, setEmail] = useState(editing?.email ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<StaffRole>(editing?.role ?? 'STAFF');

  const canSubmit = fullName.trim().length > 0 && email.trim().length > 0 && (editing || password.length >= 8);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-white p-6">
        <h3 className="mb-4 text-base font-semibold text-ink">{editing ? t('users.editTitle') : t('users.addTitle')}</h3>
        <div className="space-y-3">
          <div>
            <Label>{t('users.form.fullName')}</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <Label>{t('users.form.email')}</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {!editing && (
            <div>
              <Label>{t('users.form.password')}</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          )}
          <div>
            <Label>{t('users.form.role')}</Label>
            <Select value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`users.role.${r}`)}
                </option>
              ))}
            </Select>
          </div>
          <FieldError message={error ?? undefined} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            disabled={!canSubmit || submitting}
            onClick={() => onSubmit({ fullName, email, role, ...(editing ? {} : { password }) })}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
