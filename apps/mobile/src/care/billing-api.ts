import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientInvoice, CreateIssueReportBody, MyIssueReport, PayhereCheckout } from '@care-platform/shared';
import { api } from '@/api';
import { useClient } from './api';

/** The client's invoices and issue reports (the website's /account/invoices and booking reports). */
const key = (userId: string | undefined) => ['client-care', userId ?? 'none'] as const;

export function useMyInvoices() {
  const client = useClient();
  return useQuery({
    queryKey: [...key(client?.userId), 'invoices'],
    queryFn: () => api.get<ClientInvoice[]>('/me/invoices'),
    enabled: Boolean(client),
  });
}

/**
 * One invoice. With `poll`, it is asked again every 3 seconds while still
 * unpaid: after PayHere, the app waits for PayHere's own confirmation to
 * reach us rather than trusting the return.
 */
export function useMyInvoice(id: string | null, poll = false) {
  const client = useClient();
  return useQuery({
    queryKey: [...key(client?.userId), 'invoices', id],
    queryFn: () => api.get<ClientInvoice>(`/me/invoices/${encodeURIComponent(id!)}`),
    enabled: Boolean(client && id),
    refetchInterval: (q) => (poll && q.state.data?.status === 'ISSUED' ? 3000 : false),
  });
}

/** Starts a PayHere checkout for the balance: the form to post to PayHere. */
export function useStartOnlinePayment(id: string) {
  return useMutation({
    mutationFn: (email?: string) => api.post<PayhereCheckout>(`/me/invoices/${encodeURIComponent(id)}/payhere`, email ? { email } : {}),
  });
}

export function useMyIssues() {
  const client = useClient();
  return useQuery({
    queryKey: [...key(client?.userId), 'issues'],
    queryFn: () => api.get<MyIssueReport[]>('/me/issues'),
    enabled: Boolean(client),
  });
}

export function useReportBookingIssue(bookingId: string) {
  const queryClient = useQueryClient();
  const client = useClient();
  return useMutation({
    mutationFn: (body: CreateIssueReportBody) => api.post<MyIssueReport>(`/me/bookings/${encodeURIComponent(bookingId)}/issues`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...key(client?.userId), 'issues'] }),
  });
}
