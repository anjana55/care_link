import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AiSearchPanel } from '@/components/search/ai-search-panel';
import { renderWithProviders } from '@/lib/test/test-utils';
import { ApiError } from '@/lib/api/client';

const aiExtract = jest.fn();
jest.mock('@/lib/api/public-search', () => ({
  publicSearchApi: { aiExtract: (...a: unknown[]) => aiExtract(...a) },
}));
jest.mock('@/lib/hooks/use-public-search', () => ({
  useMetaSkills: () => ({ data: [{ id: SKILL, name: 'Dementia Care', category: null }] }),
  useMetaLanguages: () => ({ data: [] }),
  useLocationTree: () => ({ data: [{ id: 1, name: 'Central', districts: [{ id: 5, name: 'Kandy' }] }] }),
  useCities: () => ({ data: [] }),
}));

const SKILL = '33333333-3333-4333-8333-333333333333';
const QUERY = 'My mother in Kandy has dementia and needs night care';

function setup() {
  const onSubmit = jest.fn();
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(<QueryClientProvider client={client}>{renderWithProviders(<AiSearchPanel onSubmit={onSubmit} />)}</QueryClientProvider>);
  fireEvent.change(screen.getByLabelText(/describe the care you need/i), { target: { value: QUERY } });
  fireEvent.click(screen.getByRole('button', { name: /understand my request/i }));
  return onSubmit;
}

beforeEach(() => aiExtract.mockReset());

describe('AiSearchPanel', () => {
  it('shows what was understood in the search form, and searches with the checked requirements and the original words', async () => {
    aiExtract.mockResolvedValue({
      requirements: { location: { districtId: 5 }, shift: 'NIGHT', optionalSkillIds: [SKILL], desiredStartDate: '2026-11-01', page: 1, pageSize: 20 },
      summary: { patient: [], location: ['Kandy'], care: ['Night care'], preferences: ['Nice to have: Dementia Care'] },
    });
    const onSubmit = setup();

    await waitFor(() => expect(screen.getByText('Night care')).toBeInTheDocument());
    expect(aiExtract).toHaveBeenCalledWith(QUERY, 'en');
    expect(screen.getByText('Nice to have: Dementia Care')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /search with these requirements/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ location: { districtId: 5 }, shift: 'NIGHT', desiredStartDate: '2026-11-01' });
    expect(onSubmit.mock.calls[0][1]).toBe(QUERY);
  });

  it('asks for what the AI could not tell before searching', async () => {
    aiExtract.mockResolvedValue({ requirements: { page: 1, pageSize: 20 }, summary: { patient: [], location: [], care: [], preferences: [] } });
    const onSubmit = setup();
    await waitFor(() => expect(screen.getByRole('button', { name: /search with these requirements/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /search with these requirements/i }));
    await waitFor(() => expect(screen.getByText(/please select a district/i)).toBeInTheDocument());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('points to Normal Search when AI is unavailable', async () => {
    aiExtract.mockRejectedValue(new ApiError(503, 'AI search is not available right now'));
    setup();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/please use normal search/i));
  });
});
