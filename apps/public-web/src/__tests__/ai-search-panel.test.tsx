import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AiSearchPanel, combineTurns } from '@/components/search/ai-search-panel';
import { renderWithProviders } from '@/lib/test/test-utils';
import { ApiError } from '@/lib/api/client';

const aiExtract = jest.fn();
jest.mock('@/lib/api/public-search', () => ({
  publicSearchApi: { aiExtract: (...a: unknown[]) => aiExtract(...a) },
}));
jest.mock('@/lib/hooks/use-public-search', () => ({
  useLocationTree: () => ({ data: [{ id: 1, name: 'Central', districts: [{ id: 5, name: 'Kandy' }, { id: 6, name: 'Matale' }] }] }),
}));

const SKILL = '33333333-3333-4333-8333-333333333333';
const QUERY = 'My mother has dementia and needs night care';
const EMPTY = { patient: [], location: [], care: [], preferences: [] };

function setup(props: Partial<React.ComponentProps<typeof AiSearchPanel>> = {}) {
  const onSearch = jest.fn();
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(<QueryClientProvider client={client}>{renderWithProviders(<AiSearchPanel onSearch={onSearch} {...props} />)}</QueryClientProvider>);
  fireEvent.change(screen.getByLabelText(/describe the care you need/i), { target: { value: QUERY } });
  fireEvent.click(screen.getByRole('button', { name: /find caregivers/i }));
  return onSearch;
}

beforeEach(() => aiExtract.mockReset());

describe('AiSearchPanel', () => {
  it('searches straight away when the description is enough, and shows what was understood', async () => {
    aiExtract.mockResolvedValue({
      requirements: { location: { districtId: 5 }, shift: 'NIGHT', optionalSkillIds: [SKILL], desiredStartDate: '2026-11-01', page: 1, pageSize: 20 },
      summary: { patient: [], location: ['Kandy'], care: ['Night care'], preferences: ['Nice to have: Dementia Care'] },
      missing: [],
      assumed: [],
    });
    const onSearch = setup();

    await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(1));
    expect(aiExtract).toHaveBeenCalledWith(QUERY, 'en');
    expect(onSearch.mock.calls[0][0]).toMatchObject({ location: { districtId: 5 }, shift: 'NIGHT', desiredStartDate: '2026-11-01' });
    expect(onSearch.mock.calls[0][1]).toBe(QUERY);
    expect(screen.getByText('Night care')).toBeInTheDocument();
    expect(screen.getByText(/here are caregivers who match/i)).toBeInTheDocument();
    // There was care detail, so no nudge for more.
    expect(screen.queryByText(/want better matches/i)).not.toBeInTheDocument();
  });

  it('asks where the care is needed when it cannot tell, then searches with the answer', async () => {
    aiExtract.mockResolvedValueOnce({
      requirements: { shift: 'NIGHT', desiredStartDate: '2026-10-20', page: 1, pageSize: 20 },
      summary: { ...EMPTY, care: ['Night care', 'Starting as soon as possible'] },
      missing: ['location'],
      assumed: ['desiredStartDate'],
    });
    const onSearch = setup();

    await waitFor(() => expect(screen.getByText(/where is the care needed/i)).toBeInTheDocument());
    expect(onSearch).not.toHaveBeenCalled();

    aiExtract.mockResolvedValueOnce({
      requirements: { location: { districtId: 5 }, shift: 'NIGHT', desiredStartDate: '2026-10-20', page: 1, pageSize: 20 },
      summary: { ...EMPTY, location: ['Kandy'], care: ['Night care', 'Starting as soon as possible'] },
      missing: [],
      assumed: ['desiredStartDate'],
    });
    fireEvent.change(screen.getByLabelText(/your answer/i), { target: { value: 'Peradeniya' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(1));
    // The model reads the whole conversation, not the answer alone.
    expect(aiExtract).toHaveBeenLastCalledWith(`${QUERY}\nPeradeniya`, 'en');
    expect(onSearch.mock.calls[0][0]).toMatchObject({ location: { districtId: 5 } });
    expect(onSearch.mock.calls[0][1]).toBe(`${QUERY}\nPeradeniya`);
  });

  it('lets the visitor pick a district instead, and searches without asking the model again', async () => {
    aiExtract.mockResolvedValue({
      requirements: { desiredStartDate: '2026-10-20', page: 1, pageSize: 20 },
      summary: { ...EMPTY, care: ['Starting as soon as possible'] },
      missing: ['location'],
      assumed: ['desiredStartDate'],
    });
    const onSearch = setup();

    await waitFor(() => expect(screen.getByLabelText(/or choose a district/i)).toBeInTheDocument());
    // Nothing about the care was understood, so the question asks more openly.
    expect(screen.getByText(/anything you can about the person/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/or choose a district/i), { target: { value: '6' } });
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(aiExtract).toHaveBeenCalledTimes(1);
    expect(onSearch.mock.calls[0][0]).toMatchObject({ location: { districtId: 6 }, desiredStartDate: '2026-10-20' });
    expect(onSearch.mock.calls[0][1]).toBe(`${QUERY}\nMatale`);
    // Results are area-only, so the assistant invites more detail.
    expect(screen.getByText(/want better matches/i)).toBeInTheDocument();
  });

  it('offers Normal Search when AI is unavailable', async () => {
    aiExtract.mockRejectedValue(new ApiError(503, 'AI search is not available right now'));
    const onUseNormalSearch = jest.fn();
    setup({ onUseNormalSearch });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/please use normal search/i));
    fireEvent.click(screen.getByRole('button', { name: /use normal search/i }));
    expect(onUseNormalSearch).toHaveBeenCalled();
  });

  it('starting over clears the conversation', async () => {
    aiExtract.mockResolvedValue({ requirements: { location: { districtId: 5 }, desiredStartDate: '2026-10-20' }, summary: EMPTY, missing: [] });
    const onReset = jest.fn();
    setup({ onReset });
    await waitFor(() => expect(screen.getByRole('button', { name: /start over/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /start over/i }));
    expect(onReset).toHaveBeenCalled();
    expect(screen.getByLabelText(/describe the care you need/i)).toHaveValue('');
  });
});

describe('combineTurns', () => {
  it('joins messages one per line and drops the oldest follow-ups, never the first description, when too long', () => {
    expect(combineTurns(['a', 'b'])).toBe('a\nb');
    const first = 'x'.repeat(700);
    const text = combineTurns([first, 'y'.repeat(200), 'z'.repeat(200)]);
    expect(text.startsWith(first)).toBe(true);
    expect(text.endsWith('z'.repeat(200))).toBe(true);
    expect(text).not.toContain('y');
  });
});
