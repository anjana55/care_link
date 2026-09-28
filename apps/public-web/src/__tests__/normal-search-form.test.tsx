import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NormalSearchForm } from '@/components/search/normal-search-form';
import { renderWithProviders } from '@/lib/test/test-utils';
import type { SearchRequest } from '@care-platform/shared';

// The meta hooks power the district/city dropdowns. Stubbed at the module
// boundary so this test exercises form validation, not the network.
jest.mock('@/lib/hooks/use-public-search', () => ({
  useMetaSkills: () => ({ data: [] }),
  useMetaLanguages: () => ({ data: [] }),
  useMetaLocations: () => ({ data: [{ id: 'l1', district: 'Colombo', city: 'Colombo', province: 'Western' }] }),
}));

const district = () => screen.getByLabelText(/district/i);
const startDate = () => screen.getByLabelText(/desired start date/i);
const submit = () => screen.getByRole('button', { name: /search caregivers/i });

/** Sets the React state a controlled-looking `register`ed select/input needs. */
const chooseDistrict = () => fireEvent.change(district(), { target: { value: 'Colombo' } });
const chooseStartDate = () => fireEvent.change(startDate(), { target: { value: '2026-10-01' } });

describe('NormalSearchForm', () => {
  it('blocks submit and explains why when nothing is filled in', async () => {
    const onSubmit = jest.fn();
    render(renderWithProviders(<NormalSearchForm onSubmit={onSubmit} />));

    fireEvent.click(submit());

    await waitFor(() => expect(screen.getByText(/please select a district/i)).toBeInTheDocument());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(district()).toHaveAttribute('aria-invalid', 'true');
  });

  it('submits when only the two required fields are filled in', async () => {
    const onSubmit = jest.fn();
    render(renderWithProviders(<NormalSearchForm onSubmit={onSubmit} />));

    chooseDistrict();
    chooseStartDate();
    fireEvent.click(submit());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      location: { district: 'Colombo' },
      desiredStartDate: '2026-10-01',
    });
  });

  // The original defect: untouched number inputs submitted NaN and blank
  // selects submitted '', which failed validation on 7 fields at once. The
  // submit handler must now reach the API with just the required two.
  it('does not let untouched optional fields block the search', async () => {
    const onSubmit = jest.fn();
    render(renderWithProviders(<NormalSearchForm onSubmit={onSubmit} />));

    // Age, min experience and both budget fields are left completely blank.
    chooseDistrict();
    chooseStartDate();
    fireEvent.click(submit());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submitted = onSubmit.mock.calls[0][0] as SearchRequest;
    expect(submitted.patient?.age).toBeUndefined();
    expect(submitted.minimumExperienceYears).toBeUndefined();
    expect(submitted.budget?.dailyRate).toBeUndefined();
    expect(submitted.location?.city).toBeUndefined();
  });

  it('clears the district error once a district is chosen', async () => {
    render(renderWithProviders(<NormalSearchForm onSubmit={jest.fn()} />));

    fireEvent.click(submit());
    await waitFor(() => expect(screen.getByText(/please select a district/i)).toBeInTheDocument());

    chooseDistrict();
    await waitFor(() => expect(screen.queryByText(/please select a district/i)).not.toBeInTheDocument());
  });

  it('marks both required fields for assistive tech without blocking on native validation', () => {
    render(renderWithProviders(<NormalSearchForm onSubmit={jest.fn()} />));

    // aria-required, not `required` - the native attribute would let the
    // browser block submit with an untranslated tooltip before zod runs.
    expect(district()).toHaveAttribute('aria-required', 'true');
    expect(startDate()).toHaveAttribute('aria-required', 'true');
    expect(district()).not.toHaveAttribute('required');
    expect(startDate()).not.toHaveAttribute('required');
  });

  it('tells the user the start date does not affect results yet', () => {
    render(renderWithProviders(<NormalSearchForm onSubmit={jest.fn()} />));
    expect(screen.getByText(/does not change results today/i)).toBeInTheDocument();
  });
});
