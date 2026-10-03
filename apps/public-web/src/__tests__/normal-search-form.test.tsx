import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NormalSearchForm } from '@/components/search/normal-search-form';
import { renderWithProviders } from '@/lib/test/test-utils';
import type { SearchRequest } from '@care-platform/shared';

// The meta hooks power the district/city dropdowns. Stubbed at the module
// boundary so this test exercises form validation, not the network.
jest.mock('@/lib/hooks/use-public-search', () => ({
  useMetaSkills: () => ({ data: [] }),
  useMetaLanguages: () => ({ data: [] }),
  useLocationTree: () => ({
    data: [
      { id: 1, name: 'Western Province', districts: [{ id: 1, name: 'Colombo' }, { id: 2, name: 'Gampaha' }] },
    ],
  }),
  // Cities are fetched per district, so this returns them only for the
  // district that has been chosen - the same guard the real hook applies.
  useCities: (districtId: number | null) => ({
    data: districtId === 1 ? [{ id: 118, name: 'Colombo 15', subName: null, postcode: '00100', latitude: 6.9, longitude: 79.8 }] : [],
  }),
}));

const district = () => screen.getByLabelText(/district/i);
const startDate = () => screen.getByLabelText(/desired start date/i);
const submit = () => screen.getByRole('button', { name: /search caregivers/i });

/** The selects carry ids as values, so picking Colombo means choosing 1. */
const chooseDistrict = () => fireEvent.change(district(), { target: { value: '1' } });
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
      location: { districtId: 1 },
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
    expect(submitted.location?.cityId).toBeUndefined();
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

  it('offers the chosen district\'s cities, and only those', () => {
    render(renderWithProviders(<NormalSearchForm onSubmit={jest.fn()} />));

    // Before a district is picked there is nothing to narrow to.
    expect(screen.getByLabelText(/city/i)).toBeDisabled();

    chooseDistrict();

    expect(screen.getByRole('option', { name: 'Colombo 15' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Negombo' })).not.toBeInTheDocument();
  });

  it('clears a chosen city when the district changes under it', async () => {
    // A city from the previous district is no longer on the list, and a stale
    // city/district pair is exactly what the API rejects with a 400.
    const onSubmit = jest.fn();
    render(renderWithProviders(<NormalSearchForm onSubmit={onSubmit} />));

    chooseDistrict();
    fireEvent.change(screen.getByLabelText(/city/i), { target: { value: '118' } });
    chooseStartDate();
    fireEvent.click(submit());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ location: { districtId: 1, cityId: 118 } });

    fireEvent.change(district(), { target: { value: '2' } });
    fireEvent.click(submit());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1][0]).toMatchObject({ location: { districtId: 2 } });
    expect((onSubmit.mock.calls[1][0] as SearchRequest).location?.cityId).toBeUndefined();
  });
});
