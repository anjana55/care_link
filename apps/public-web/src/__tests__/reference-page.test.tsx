import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@/lib/i18n';
import { ApiError } from '@/lib/api/client';
import ReferencePage from '@/app/reference/page';

/**
 * A caregiver's referee opens the link they were sent: three questions, once.
 * The page shows only who is asking about whom.
 */

const post = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), usePathname: () => '/reference', useSearchParams: () => new URLSearchParams() }));
jest.mock('@/lib/api/client', () => ({
  ...jest.requireActual('@/lib/api/client'),
  api: { get: jest.fn(), post: (...a: unknown[]) => post(...a), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock('@/components/layout/site-header', () => ({ SiteHeader: () => null }));
jest.mock('@/components/layout/site-footer', () => ({ SiteFooter: () => null }));

const TOKEN = 'a'.repeat(43);
const show = () => render(<I18nProvider>{<ReferencePage />}</I18nProvider>);

beforeEach(() => {
  post.mockReset();
  window.history.replaceState(null, '', `/reference?token=${TOKEN}`);
});

describe('reference page', () => {
  it('asks the three questions and sends the answers', async () => {
    post.mockResolvedValueOnce({ caregiverName: 'Kamala Perera', relationship: 'Former employer', refereeName: 'Nimal', answered: false }).mockResolvedValueOnce({ ok: true });
    show();
    expect(await screen.findByText('Hello Nimal')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/public/references/check', { token: TOKEN });
    const send = screen.getByRole('button', { name: 'Send my answers' });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getAllByLabelText('Yes')[0]);
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByLabelText('More than 3 years'));
    fireEvent.click(screen.getAllByLabelText('Yes')[1]);
    fireEvent.change(screen.getByLabelText(/Anything you would like to add/), { target: { value: ' Very caring ' } });
    fireEvent.click(send);
    expect(await screen.findByText('Thank you')).toBeInTheDocument();
    expect(post).toHaveBeenLastCalledWith('/public/references/answer', { token: TOKEN, knowsThem: true, years: 'OVER_3', wouldTrust: 'YES', comment: 'Very caring' });
  });

  it('lets someone who does not know the caregiver say so, without the other questions', async () => {
    post.mockResolvedValueOnce({ caregiverName: 'Kamala Perera', relationship: 'Neighbour', refereeName: 'Sunil', answered: false }).mockResolvedValueOnce({ ok: true });
    show();
    fireEvent.click(await screen.findByLabelText('No'));
    expect(screen.queryByText('How long have you known them?')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send my answers' }));
    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/public/references/answer', { token: TOKEN, knowsThem: false }));
  });

  it('says so when the link is not valid, or was already answered', async () => {
    post.mockRejectedValueOnce(new ApiError(404, 'This link is not valid or has expired'));
    const { unmount } = show();
    expect(await screen.findByText('This link does not work')).toBeInTheDocument();
    unmount();
    post.mockResolvedValueOnce({ caregiverName: 'K', relationship: 'R', refereeName: 'N', answered: true });
    show();
    expect(await screen.findByText('Thank you')).toBeInTheDocument();
  });
});
