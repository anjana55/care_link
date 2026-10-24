import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FinderPage } from '@/components/search/finder-page';
import { renderWithProviders } from '@/lib/test/test-utils';

let aiEnabled = true;
const aiExtract = jest.fn();
const searchCalls: unknown[][] = [];

jest.mock('@/components/layout/site-header', () => ({ SiteHeader: () => null }));
jest.mock('@/components/layout/site-footer', () => ({ SiteFooter: () => null }));
jest.mock('@/components/sections/supporting-sections', () => ({
  HowItWorksSection: () => null,
  TrustSection: () => null,
  MultilingualSection: () => null,
  CallToActionSection: () => null,
}));
jest.mock('@/components/results/results-list', () => ({
  ResultsList: ({ response }: { response: { total: number } }) => <p>{response.total} caregivers found</p>,
}));
jest.mock('@/lib/hooks/use-client-care', () => ({ useIsClient: () => null }));
jest.mock('@/components/care/find-for-me', () => ({ FindForMeCard: () => null }));
jest.mock('@/lib/api/public-search', () => ({
  publicSearchApi: { aiExtract: (...a: unknown[]) => aiExtract(...a) },
}));
jest.mock('@/lib/hooks/use-public-search', () => ({
  useSearchConfig: () => ({ data: { aiSearchEnabled: aiEnabled }, isLoading: false }),
  useMetaSkills: () => ({ data: [] }),
  useMetaLanguages: () => ({ data: [] }),
  useLocationTree: () => ({ data: [{ id: 1, name: 'Central', districts: [{ id: 5, name: 'Kandy' }] }] }),
  useCities: () => ({ data: [] }),
  useClientSearchOrigin: () => ({ data: undefined }),
  isRunnableSearch: (r: { careType?: string; location?: { districtId?: number }; desiredStartDate?: string }) =>
    Boolean(r.careType && r.location?.districtId && r.desiredStartDate),
  useCaregiverSearch: (...args: unknown[]) => {
    searchCalls.push(args);
    return args[0]
      ? { data: { items: [{ publicId: 'a' }], page: 1, pageSize: 20, total: 7, totalPages: 1 }, isLoading: false, isError: false, refetch: jest.fn() }
      : { data: undefined, isLoading: false, isError: false, refetch: jest.fn() };
  },
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{renderWithProviders(<FinderPage />)}</QueryClientProvider>);
}

beforeEach(() => {
  aiEnabled = true;
  aiExtract.mockReset();
  searchCalls.length = 0;
  window.localStorage.clear();
});

describe('FinderPage', () => {
  it('opens on AI Search when it is enabled', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: 'AI Search' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText(/describe the care you need/i)).toBeInTheDocument();
  });

  it('does not re-run a remembered search saved before the type of care was required, and asks for it instead', async () => {
    window.localStorage.setItem(
      'care-platform-last-search',
      JSON.stringify({ at: Date.now(), request: { location: { districtId: 5 }, desiredStartDate: '2026-11-01', page: 1 }, aiQuery: 'night nurse in Kandy' }),
    );
    renderPage();

    expect(await screen.findByText(/please choose the type of care/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Normal Search' })).toHaveAttribute('aria-selected', 'true');
    // Nothing was sent to the API - every search call had no request.
    expect(searchCalls.every(([request]) => request === null)).toBe(true);
    expect(screen.queryByText(/caregivers found/)).not.toBeInTheDocument();
  });

  it('opens on Normal Search when AI is off', () => {
    aiEnabled = false;
    renderPage();
    expect(screen.getByRole('tab', { name: 'Normal Search' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByLabelText(/describe the care you need/i)).not.toBeInTheDocument();
  });

  it('shows caregivers after one message, with the advanced filters below them', async () => {
    aiExtract.mockResolvedValue({
      requirements: { careType: 'HOME_SHIFT', location: { districtId: 5 }, shift: 'NIGHT', desiredStartDate: '2026-10-20', page: 1, pageSize: 20 },
      summary: { patient: [], location: ['Kandy'], care: ['Night care'], preferences: [] },
      missing: [],
      assumed: ['desiredStartDate'],
    });
    renderPage();
    fireEvent.change(screen.getByLabelText(/describe the care you need/i), { target: { value: 'Night nurse for my father in Kandy' } });
    fireEvent.click(screen.getByRole('button', { name: /find caregivers/i }));

    const results = await screen.findByText('7 caregivers found');
    const refine = screen.getByRole('heading', { name: /refine your search/i });
    // Results first, filters after them.
    expect(results.compareDocumentPosition(refine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The AI endpoint is used, with the visitor's words.
    await waitFor(() => expect(searchCalls.at(-1)?.[1]).toBe('Night nurse for my father in Kandy'));
  });
});
