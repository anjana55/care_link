'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { useStaffUsers } from '@/lib/hooks/use-users';
import { api, ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserFormModal, type UserFormValues } from '@/components/users/user-form-modal';
import { ResetPasswordModal } from '@/components/users/reset-password-modal';
import type { StaffUser } from '@/lib/api/types';

export default function UsersPage() {
  const { t } = useTranslation();
  const { user: currentUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  // This module is admin-only - anyone else who navigates here is bounced
  // straight back to the dashboard, same as the CAREGIVER redirect in the
  // shared (app) layout.
  useEffect(() => {
    if (authLoading) return;
    if (currentUser && currentUser.role !== 'ADMIN') {
      router.replace('/dashboard');
    }
  }, [authLoading, currentUser, router]);

  const { data: users, isLoading } = useStaffUsers();

  const filtered = useMemo(() => {
    if (!users) return [];
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [users, search]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const createMutation = useMutation({
    mutationFn: (values: UserFormValues) => api.post<StaffUser>('/users', values),
    onSuccess: () => {
      invalidate();
      setAddOpen(false);
      setFormError(null);
    },
    onError: (err: unknown) => setFormError(err instanceof ApiError ? err.message : 'Something went wrong'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: UserFormValues }) =>
      api.patch<StaffUser>(`/users/${id}`, { fullName: values.fullName, email: values.email, role: values.role }),
    onSuccess: () => {
      invalidate();
      setEditing(null);
      setFormError(null);
    },
    onError: (err: unknown) => setFormError(err instanceof ApiError ? err.message : 'Something went wrong'),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({ id, newPassword }: { id: string; newPassword: string }) =>
      api.post(`/users/${id}/reset-password`, { newPassword }),
    onSuccess: () => {
      setResettingId(null);
      setFormError(null);
    },
    onError: (err: unknown) => setFormError(err instanceof ApiError ? err.message : 'Something went wrong'),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.patch(`/users/${id}/active`, { isActive }),
    onSuccess: () => {
      invalidate();
      setRowError(null);
    },
    onError: (err: unknown, vars) =>
      setRowError({ id: vars.id, message: err instanceof ApiError ? err.message : 'Something went wrong' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => {
      invalidate();
      setDeleteConfirmId(null);
    },
    onError: (err: unknown) =>
      setRowError({ id: deleteConfirmId ?? '', message: err instanceof ApiError ? err.message : 'Something went wrong' }),
  });

  // Guarded above with a redirect, but avoid rendering the table for a
  // split second before that effect fires.
  if (authLoading || !currentUser || currentUser.role !== 'ADMIN') {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">
        <span>{t('common.loading')}</span>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">{t('users.title')}</h1>
        <Button
          onClick={() => {
            setFormError(null);
            setAddOpen(true);
          }}
        >
          <Plus size={16} />
          {t('users.addNew')}
        </Button>
      </div>
      <p className="mb-6 text-sm text-ink/60">{t('users.subtitle')}</p>

      <div className="mb-4">
        <Input placeholder={t('users.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-paper text-xs uppercase tracking-wide text-ink/50">
            <tr>
              <th className="px-4 py-3 font-medium">{t('users.table.name')}</th>
              <th className="px-4 py-3 font-medium">{t('users.table.email')}</th>
              <th className="px-4 py-3 font-medium">{t('users.table.role')}</th>
              <th className="px-4 py-3 font-medium">{t('users.table.status')}</th>
              <th className="px-4 py-3 font-medium">{t('users.table.lastLogin')}</th>
              <th className="px-4 py-3 font-medium">{t('users.table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink/50">
                  {t('common.loading')}
                </td>
              </tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink/50">
                  {t('users.empty')}
                </td>
              </tr>
            )}
            {filtered.map((u) => {
              const isSelf = u.id === currentUser.userId;
              return (
                <tr key={u.id} className="border-b border-border last:border-0 hover:bg-paper align-top">
                  <td className="px-4 py-3 text-ink">
                    {u.fullName}
                    {isSelf && <span className="ml-1.5 text-xs text-ink/40">({t('users.you')})</span>}
                  </td>
                  <td className="px-4 py-3 text-ink/70">{u.email}</td>
                  <td className="px-4 py-3 text-ink/70">{t(`users.role.${u.role}`)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        u.isActive
                          ? 'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-brand-light text-brand-dark'
                          : 'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-ink/10 text-ink/60'
                      }
                    >
                      {u.isActive ? t('users.status.active') : t('users.status.inactive')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink/70">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : t('users.never')}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <button
                        className="text-sm text-brand-dark hover:underline"
                        onClick={() => {
                          setFormError(null);
                          setEditing(u);
                        }}
                      >
                        {t('users.actions.edit')}
                      </button>
                      <button
                        className="text-sm text-brand-dark hover:underline"
                        onClick={() => {
                          setFormError(null);
                          setResettingId(u.id);
                        }}
                      >
                        {t('users.actions.resetPassword')}
                      </button>
                      {!isSelf && (
                        <button
                          className="text-sm text-brand-dark hover:underline"
                          disabled={toggleActiveMutation.isPending}
                          onClick={() => toggleActiveMutation.mutate({ id: u.id, isActive: !u.isActive })}
                        >
                          {u.isActive ? t('users.actions.deactivate') : t('users.actions.activate')}
                        </button>
                      )}
                      {!isSelf && (
                        <button className="text-sm text-danger hover:underline" onClick={() => setDeleteConfirmId(u.id)}>
                          {t('users.actions.delete')}
                        </button>
                      )}
                    </div>
                    {rowError?.id === u.id && <p className="mt-1 text-xs text-danger">{rowError.message}</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {addOpen && (
        <UserFormModal
          submitting={createMutation.isPending}
          error={formError}
          onClose={() => setAddOpen(false)}
          onSubmit={(values) => createMutation.mutate(values)}
        />
      )}

      {editing && (
        <UserFormModal
          editing={editing}
          submitting={updateMutation.isPending}
          error={formError}
          onClose={() => setEditing(null)}
          onSubmit={(values) => updateMutation.mutate({ id: editing.id, values })}
        />
      )}

      {resettingId && (
        <ResetPasswordModal
          submitting={resetPasswordMutation.isPending}
          error={formError}
          onClose={() => setResettingId(null)}
          onSubmit={(newPassword) => resetPasswordMutation.mutate({ id: resettingId, newPassword })}
        />
      )}

      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-sm rounded-lg border border-border bg-white p-6">
            <h3 className="mb-2 text-base font-semibold text-ink">{t('users.deleteTitle')}</h3>
            <p className="mb-4 text-sm text-ink/60">{t('users.confirmDelete')}</p>
            {rowError?.id === deleteConfirmId && <p className="mb-3 text-xs text-danger">{rowError.message}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setDeleteConfirmId(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" size="sm" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(deleteConfirmId)}>
                {t('common.confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
