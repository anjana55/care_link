'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type {
  BillingLineInput,
  BillingSettings,
  CreateInvoiceInput,
  InvoiceDetail,
  InvoiceListResponse,
  InvoiceStatus,
  InvoiceSummary,
  PaymentMethod,
  PayoutDetail,
  PayoutListResponse,
  PayoutStatus,
  PayoutSummary,
} from '../api/types';

const qs = (f: Record<string, unknown>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '' && v !== false) q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

// --- invoices --------------------------------------------------------------------

export interface InvoiceFilters {
  status?: InvoiceStatus;
  overdue?: boolean;
  search?: string;
  patientId?: string;
  bookingId?: string;
  page?: number;
  pageSize?: number;
}

export function useInvoices(filters: InvoiceFilters, enabled = true) {
  return useQuery({
    queryKey: ['invoices', 'list', filters],
    queryFn: () => api.get<InvoiceListResponse>(`/invoices${qs(filters as Record<string, unknown>)}`),
    enabled,
  });
}

export function useInvoiceSummary(enabled = true) {
  return useQuery({ queryKey: ['invoices', 'summary'], queryFn: () => api.get<InvoiceSummary>('/invoices/summary'), enabled, refetchInterval: 60_000 });
}

export function useInvoice(id: string) {
  return useQuery({ queryKey: ['invoices', 'detail', id], queryFn: () => api.get<InvoiceDetail>(`/invoices/${id}`), enabled: Boolean(id) });
}

function useInvoiceWrite<V>(id: string, fn: (v: V) => Promise<InvoiceDetail>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (detail) => {
      queryClient.setQueryData(['invoices', 'detail', detail.id], detail);
      queryClient.invalidateQueries({ queryKey: ['invoices', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', 'summary'] });
      if (detail.id !== id) queryClient.invalidateQueries({ queryKey: ['invoices', 'detail', id] });
    },
  });
}

export function useCreateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInvoiceInput) => api.post<InvoiceDetail>('/invoices', input),
    onSuccess: (detail) => {
      queryClient.setQueryData(['invoices', 'detail', detail.id], detail);
      queryClient.invalidateQueries({ queryKey: ['invoices', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', 'summary'] });
    },
  });
}

export interface InvoiceUpdate {
  billToName?: string;
  billToAddress?: string;
  billToPhone?: string;
  billToEmail?: string;
  periodStart?: string;
  periodEnd?: string;
  discountType?: 'PERCENT' | 'AMOUNT' | null;
  discountValue?: string | null;
  discountReason?: string | null;
  applyTax?: boolean;
  notes?: string;
  language?: 'en' | 'si' | 'ta';
}

export const useUpdateInvoice = (id: string) => useInvoiceWrite(id, (v: InvoiceUpdate) => api.patch<InvoiceDetail>(`/invoices/${id}`, v));
export const useReplaceInvoiceLines = (id: string) => useInvoiceWrite(id, (lines: BillingLineInput[]) => api.put<InvoiceDetail>(`/invoices/${id}/lines`, { lines }));
export const useAddInvoiceShiftLines = (id: string) => useInvoiceWrite(id, () => api.post<InvoiceDetail>(`/invoices/${id}/lines/from-shifts`, {}));
export const useIssueInvoice = (id: string) =>
  useInvoiceWrite(id, (v: { issueDate?: string; dueDate?: string; notify?: boolean }) => api.post<InvoiceDetail>(`/invoices/${id}/issue`, v));
export const useSendInvoice = (id: string) => useInvoiceWrite(id, () => api.post<InvoiceDetail>(`/invoices/${id}/send`, {}));
export const useVoidInvoice = (id: string) => useInvoiceWrite(id, (reason: string) => api.post<InvoiceDetail>(`/invoices/${id}/void`, { reason }));
export const useReviseInvoice = (id: string) => useInvoiceWrite(id, (reason: string) => api.post<InvoiceDetail>(`/invoices/${id}/revise`, { reason }));
export const useAddInvoiceNote = (id: string) => useInvoiceWrite(id, (note: string) => api.post<InvoiceDetail>(`/invoices/${id}/notes`, { note }));
export const useRecordPayment = (id: string) =>
  useInvoiceWrite(
    id,
    (v: { kind?: 'PAYMENT' | 'REFUND'; amount: string; method: PaymentMethod; paidOn: string; reference?: string; note?: string; notify?: boolean }) =>
      api.post<InvoiceDetail>(`/invoices/${id}/payments`, v),
  );
export const useDeletePayment = (id: string) => useInvoiceWrite(id, (paymentId: string) => api.delete<InvoiceDetail>(`/invoices/${id}/payments/${paymentId}`));

export function useDeleteInvoice(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<{ id: string }>(`/invoices/${id}`),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['invoices', 'detail', id] });
      queryClient.invalidateQueries({ queryKey: ['invoices', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', 'summary'] });
    },
  });
}

// --- payouts ----------------------------------------------------------------------

export interface PayoutFilters {
  status?: PayoutStatus;
  caregiverId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export function usePayouts(filters: PayoutFilters, enabled = true) {
  return useQuery({
    queryKey: ['payouts', 'list', filters],
    queryFn: () => api.get<PayoutListResponse>(`/payouts${qs(filters as Record<string, unknown>)}`),
    enabled,
  });
}

export function usePayoutSummary(enabled = true) {
  return useQuery({ queryKey: ['payouts', 'summary'], queryFn: () => api.get<PayoutSummary>('/payouts/summary'), enabled });
}

export function usePayout(id: string) {
  return useQuery({ queryKey: ['payouts', 'detail', id], queryFn: () => api.get<PayoutDetail>(`/payouts/${id}`), enabled: Boolean(id) });
}

function usePayoutWrite<V>(id: string, fn: (v: V) => Promise<PayoutDetail>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (detail) => {
      queryClient.setQueryData(['payouts', 'detail', id], detail);
      queryClient.invalidateQueries({ queryKey: ['payouts', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['payouts', 'summary'] });
    },
  });
}

export function useCreatePayout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { caregiverId: string; periodStart: string; periodEnd: string }) => api.post<PayoutDetail>('/payouts', v),
    onSuccess: (detail) => {
      queryClient.setQueryData(['payouts', 'detail', detail.id], detail);
      queryClient.invalidateQueries({ queryKey: ['payouts'] });
    },
  });
}

export function useGeneratePayouts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { periodStart: string; periodEnd: string }) => api.post<{ created: number; ids: string[] }>('/payouts/generate', v),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['payouts'] }),
  });
}

export const useUpdatePayout = (id: string) => usePayoutWrite(id, (notes: string) => api.patch<PayoutDetail>(`/payouts/${id}`, { notes }));
export const useReplacePayoutLines = (id: string) => usePayoutWrite(id, (lines: BillingLineInput[]) => api.put<PayoutDetail>(`/payouts/${id}/lines`, { lines }));
export const useAddPayoutShiftLines = (id: string) => usePayoutWrite(id, () => api.post<PayoutDetail>(`/payouts/${id}/lines/from-shifts`, {}));
export const useApprovePayout = (id: string) => usePayoutWrite(id, () => api.post<PayoutDetail>(`/payouts/${id}/approve`, {}));
export const useReopenPayout = (id: string) => usePayoutWrite(id, () => api.post<PayoutDetail>(`/payouts/${id}/reopen`, {}));
export const usePayPayout = (id: string) =>
  usePayoutWrite(id, (v: { paidOn: string; method: PaymentMethod; reference?: string; notify?: boolean }) => api.post<PayoutDetail>(`/payouts/${id}/pay`, v));
export const useVoidPayout = (id: string) => usePayoutWrite(id, (reason: string) => api.post<PayoutDetail>(`/payouts/${id}/void`, { reason }));

export function useDeletePayout(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<{ id: string }>(`/payouts/${id}`),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['payouts', 'detail', id] });
      queryClient.invalidateQueries({ queryKey: ['payouts'] });
    },
  });
}

// --- settings ----------------------------------------------------------------------

export function useBillingSettings() {
  return useQuery({ queryKey: ['billing-settings'], queryFn: () => api.get<BillingSettings>('/settings/billing') });
}

export function useUpdateBillingSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: Record<string, unknown>) => api.patch<BillingSettings>('/settings/billing', v),
    onSuccess: (data) => queryClient.setQueryData(['billing-settings'], data),
  });
}
