import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FinderPage } from '@/components/search/finder-page';
import { renderWithProviders } from '@/lib/test/test-utils';

let aiEnabled = true;
let coverage: { key: string; name: string; latitude: number; longitude: number; precision: 'city'; distanceKm: null; count: number }[] = [];
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
  useCaregiverCoverage: () => ({ data: coverage }),
  useCaregiverSearch: (...args: unknown[]) => {
    searchCalls.push(args);
    return args[0]
      ? { data: { items: [{ publicId: 'a' }], page: 1, pageSize: 20, total: 7, totalPages: 1 }, isLoading: false, isError: false, refetch: jest.fn() }
      : { data: undefined, isLoading: false, isError: false, refetch: jest.fn() };
  },
}));

function renderPage(element: React.ReactElement = <FinderPage />) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{renderWithProviders(element)}</QueryClientProvider>);
}

beforeEach(() => {
  aiEnabled = true;
  coverage = [];
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

  it('shows where caregivers are on the map before anything is searched', async () => {
    coverage = [
      { key: 'c10', name: 'Negombo', latitude: 7.2, longitude: 79.83, precision: 'city', distanceKm: null, count: 4 },
      { key: 'c20', name: 'Kandy', latitude: 7.29, longitude: 80.63, precision: 'city', distanceKm: null, count: 3 },
    ];
    renderPage();
    expect(screen.getByText('7 caregivers across 2 places')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '4 caregivers live in Negombo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use my location' })).toBeInTheDocument();
  });

  it('puts the search, not a back link, at the top of the landing page', () => {
    renderPage(<FinderPage variant="landing"><p>Landing sections</p></FinderPage>);
    expect(screen.getByRole('heading', { level: 1, name: 'Find the right caregiver' })).toBeInTheDocument();
    expect(screen.getByText('Landing sections')).toBeInTheDocument();
  });
});
