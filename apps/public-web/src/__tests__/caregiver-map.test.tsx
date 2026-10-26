import { act, fireEvent, render, screen, waitFor, renderHook } from '@testing-library/react';
import type { PublicCaregiverSummary, PublicSearchResponse, SearchOrigin } from '@care-platform/shared';
import { NearbyControls, NearbySummary, useNearbyMapLabels } from '@/components/results/nearby-panel';
import { CaregiverMap } from '@/components/map/caregiver-map';
import { ResultCard } from '@/components/results/result-card';
import { circlePolygon } from '@/components/map/caregiver-map';
import { withDeviceOrigin, withProfileOrigin } from '@/components/search/finder-page';
import type { DeviceLocation } from '@/lib/hooks/use-device-location';
import { stubMaps } from '@/lib/test/maplibre-stub';
import { useDeviceLocation } from '@/lib/hooks/use-device-location';
import { renderWithProviders } from '@/lib/test/test-utils';
import { ApiError } from '@/lib/api/client';

const nearestCity = jest.fn();
jest.mock('@/lib/api/public-search', () => ({
  publicSearchApi: { nearestCity: (...a: unknown[]) => nearestCity(...a) },
}));

const ORIGIN: SearchOrigin = { latitude: 6.8511, longitude: 79.8659, source: 'searchCity', label: 'Dehiwala', radiusKm: 25 };

function caregiver(overrides: Partial<PublicCaregiverSummary> = {}): PublicCaregiverSummary {
  return {
    publicId: 'abcd1234-ef56-7890-abcd-1234567890ab',
    gender: 'FEMALE',
    approxAge: 45,
    yearsExperience: 8,
    districtId: 1,
    cityId: 654,
    district: 'Colombo',
    city: 'Moratuwa',
    preferredLocations: ['Dehiwala'],
    languages: [],
    skills: [],
    availability: { dayDuty: true, nightDuty: false, liveIn24h: false, preferredShift: 'DAY', availableFrom: null },
    hasVerifiedQualification: false,
    verified: false,
    careTypes: ['HOME_SHIFT', 'LIVE_IN'],
    qualificationSummary: [],
    relevantExperienceSummary: [],
    homeLocation: { latitude: 6.773, longitude: 79.8816, precision: 'city' },
    distanceKm: 8.9,
    serviceArea: [{ cityId: 340, name: 'Dehiwala', latitude: 6.8511, longitude: 79.8659, distanceKm: 0 }],
    reach: 'home',
    matchScore: 10,
    matchReasons: [],
    ...overrides,
  };
}

function response(overrides: Partial<PublicSearchResponse> = {}): PublicSearchResponse {
  return {
    items: [caregiver()],
    page: 1,
    pageSize: 20,
    total: 4,
    totalPages: 1,
    origin: ORIGIN,
    mapPoints: [
      { key: 'c654', name: 'Moratuwa', latitude: 6.773, longitude: 79.8816, precision: 'city', distanceKm: 8.9, count: 3 },
      { key: 'c548', name: 'Gampaha', latitude: 7.084, longitude: 80.0098, precision: 'city', distanceKm: 1, count: 1 },
    ],
    ...overrides,
  };
}

interface HarnessProps {
  response: PublicSearchResponse;
  highlighted: PublicCaregiverSummary | null;
  locating: boolean;
  locationError: Parameters<typeof NearbySummary>[0]['locationError'];
  onRadiusChange: (km: number) => void;
  onUseMyLocation: () => void;
}

/** The finder's map area as it is put together on the page: controls on the map, the summary with the results. */
function Nearby({ response, highlighted, locating, locationError, onRadiusChange, onUseMyLocation }: HarnessProps) {
  const origin = response.origin ?? null;
  const labels = useNearbyMapLabels(origin);
  const highlight = highlighted ? { home: highlighted.homeLocation, serviceArea: highlighted.serviceArea } : null;
  return (
    <>
      <NearbyControls origin={origin} onUseMyLocation={onUseMyLocation} locating={locating} onRadiusChange={onRadiusChange} />
      <NearbySummary response={response} onRadiusChange={onRadiusChange} locationError={locationError} />
      <CaregiverMap origin={origin} points={response.mapPoints ?? []} highlight={highlight} labels={labels} />
    </>
  );
}

function panel(props: Partial<HarnessProps> = {}) {
  const handlers = { onRadiusChange: jest.fn(), onUseMyLocation: jest.fn() };
  render(renderWithProviders(<Nearby response={response()} highlighted={null} locating={false} locationError={null} {...handlers} {...props} />));
  return handlers;
}

describe('Finder map and nearby summary', () => {
  it('says how many caregivers are within the radius, and where it is measured from', () => {
    panel();
    expect(screen.getByText('4 caregivers live or work within 25 km of Dehiwala')).toBeInTheDocument();
    expect(screen.getByText(/measured in a straight line from Dehiwala, the city you searched/)).toBeInTheDocument();
  });

  it('speaks about "your location" when measuring from the device', () => {
    panel({ response: response({ origin: { ...ORIGIN, source: 'device' }, total: 1 }) });
    expect(screen.getByText('1 caregiver lives or works within 25 km of your location')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use my location' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not claim a radius when it only had a district centre to measure from', () => {
    panel({ response: response({ origin: { ...ORIGIN, source: 'district', label: 'Colombo' } }) });
    expect(screen.getByText('4 caregivers live or work in or near Colombo district')).toBeInTheDocument();
    expect(screen.queryByText(/within 25 km/)).not.toBeInTheDocument();
  });

  it('puts one count per place on the map, never one pin per caregiver', async () => {
    panel();
    expect(await screen.findByRole('button', { name: '3 caregivers in Moratuwa, 8.9 km away' })).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: '1 caregiver in Gampaha, 1 km away' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Search location: Dehiwala' })).toBeInTheDocument();
  });

  it("draws a highlighted caregiver's service area", async () => {
    panel({ highlighted: caregiver() });
    expect(await screen.findByRole('img', { name: 'Works in Dehiwala, 0 km away' })).toBeInTheDocument();
  });

  it('changes the radius and asks for the device location on request', () => {
    const { onRadiusChange, onUseMyLocation } = panel();
    fireEvent.change(screen.getByLabelText('Within'), { target: { value: '50' } });
    expect(onRadiusChange).toHaveBeenCalledWith(50);
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(onUseMyLocation).toHaveBeenCalled();
  });

  it('offers a wider radius when nobody is within this one', () => {
    const { onRadiusChange } = panel({ response: response({ items: [], total: 0, mapPoints: [] }) });
    expect(screen.getByText('No caregivers within 25 km yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Search within 50 km' }));
    expect(onRadiusChange).toHaveBeenCalledWith(50);
  });

  it('explains a blocked location request', () => {
    panel({ locationError: 'denied' });
    expect(screen.getByRole('alert')).toHaveTextContent(/Location access is blocked/);
  });

  it('shows no summary when the search had no location', () => {
    panel({ response: response({ origin: null }) });
    expect(screen.queryByText('Caregivers near you')).not.toBeInTheDocument();
    expect(screen.queryByText(/live or work within/)).not.toBeInTheDocument();
  });

  it('offers "Use my location" with no radius before there is anywhere to measure from', () => {
    render(renderWithProviders(<NearbyControls origin={null} onUseMyLocation={jest.fn()} locating={false} onRadiusChange={jest.fn()} />));
    expect(screen.getByRole('button', { name: 'Use my location' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Within')).not.toBeInTheDocument();
  });

  it('labels the pre-search map by where caregivers live, not by a distance from nobody', async () => {
    panel({
      response: response({
        origin: null,
        mapPoints: [
          { key: 'c10', name: 'Negombo', latitude: 7.2, longitude: 79.83, precision: 'city', distanceKm: null, count: 4 },
          { key: 'c20', name: 'Kandy', latitude: 7.29, longitude: 80.63, precision: 'city', distanceKm: null, count: 1 },
        ],
      }),
    });
    expect(await screen.findByRole('button', { name: '4 caregivers live in Negombo' })).toHaveTextContent('4');
    expect(screen.getByRole('button', { name: '1 caregiver lives in Kandy' })).toBeInTheDocument();
  });
});

describe('CaregiverMap layout options', () => {
  const labels = {
    map: 'Map',
    origin: 'Origin',
    point: () => 'point',
    serviceCity: () => 'city',
    failed: 'failed',
    legend: { origin: 'Search location', caregivers: 'Caregivers living there', serviceArea: 'Also works in' },
  };

  it('keeps a floating panel clear when framing, and frames Sri Lanka when there is nothing to show', async () => {
    const padding = { top: 48, right: 48, bottom: 48, left: 496 };
    const before = stubMaps.length;
    render(<CaregiverMap origin={null} points={[]} labels={labels} padding={padding} />);
    await waitFor(() => expect(stubMaps.length).toBe(before + 1));
    await waitFor(() => expect(stubMaps.at(-1)?.lastFitOptions).toEqual(expect.objectContaining({ padding })));
    expect(stubMaps.at(-1)?.lastBounds).toEqual([
      [79.55, 5.9],
      [81.9, 9.85],
    ]);
  });

  it('lets a full-page map move freely and a map inside a page ask for two fingers', async () => {
    const before = stubMaps.length;
    const { rerender } = render(<CaregiverMap origin={null} points={[]} labels={labels} gestures="free" />);
    // The map is created after maplibre's dynamic import resolves.
    await waitFor(() => expect(stubMaps.length).toBe(before + 1));
    const map = stubMaps.at(-1)!;
    await waitFor(() => expect(map.lastBounds).not.toBeNull());
    expect(map.cooperativeGestures.isEnabled()).toBe(false);
    rerender(<CaregiverMap origin={null} points={[]} labels={labels} gestures="cooperative" />);
    expect(map.cooperativeGestures.isEnabled()).toBe(true);
  });

  it('can float its key over the map instead of under it', () => {
    const { container } = render(<CaregiverMap origin={null} points={[]} labels={labels} legend="overlay" />);
    const key = screen.getByText('Caregivers living there').closest('ul')!;
    expect(container.querySelector('[role="region"]')!.parentElement).toContainElement(key);
  });
});

describe('ResultCard distance', () => {
  it('shows the straight-line distance to where the caregiver lives', () => {
    render(renderWithProviders(<ResultCard caregiver={caregiver()} />));
    expect(screen.getByText(/8.9 km away/)).toBeInTheDocument();
  });

  it('says a caregiver from further away works in the area, and where', () => {
    render(
      renderWithProviders(
        <ResultCard
          caregiver={caregiver({
            distanceKm: 31,
            reach: 'serviceArea',
            serviceArea: [
              { cityId: 1, name: 'Colombo', latitude: 6.93, longitude: 79.85, distanceKm: 9.1 },
              { cityId: 340, name: 'Dehiwala', latitude: 6.85, longitude: 79.87, distanceKm: 0.4 },
            ],
          })}
        />,
      ),
    );
    expect(screen.getByText('Works in Dehiwala, 0.4 km away')).toBeInTheDocument();
  });

  it('toggles the caregiver on the map', () => {
    const onShowOnMap = jest.fn();
    const { rerender } = render(renderWithProviders(<ResultCard caregiver={caregiver()} onShowOnMap={onShowOnMap} />));
    fireEvent.click(screen.getByRole('button', { name: 'Show on map' }));
    expect(onShowOnMap).toHaveBeenCalled();
    rerender(renderWithProviders(<ResultCard caregiver={caregiver()} onShowOnMap={onShowOnMap} shownOnMap />));
    expect(screen.getByRole('button', { name: 'Hide from map' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('withDeviceOrigin', () => {
  const HERE: DeviceLocation = {
    latitude: 7.209,
    longitude: 79.836,
    city: { cityId: 10, districtId: 2, name: 'Negombo', districtName: 'Gampaha', latitude: 7.208, longitude: 79.835, distanceKm: 0.2 },
  };
  const base = { careType: 'HOME_SHIFT', page: 1, pageSize: 20 } as never;

  it('searches around the visitor when the search names no place', () => {
    expect(withDeviceOrigin(base, HERE, 10)).toMatchObject({
      location: { districtId: 2, cityId: 10 },
      origin: { latitude: 7.209, longitude: 79.836 },
      radiusKm: 10,
    });
  });

  it('keeps a place the search named, measuring distances from the visitor', () => {
    const named = { ...(base as object), location: { districtId: 5 } } as never;
    const next = withDeviceOrigin(named, HERE, 25);
    expect(next.location).toEqual({ districtId: 5 });
    expect(next.origin).toEqual({ latitude: 7.209, longitude: 79.836 });
  });

  it('changes nothing without a location, or when the search already has one', () => {
    expect(withDeviceOrigin(base, null)).toBe(base);
    const located = { ...(base as object), origin: { latitude: 6.9, longitude: 79.85 } } as never;
    expect(withDeviceOrigin(located, HERE)).toBe(located);
  });
});

describe('withProfileOrigin', () => {
  const base = { location: { districtId: 1 }, page: 1 };

  it('falls back to the profile city when the search names no city', () => {
    expect(withProfileOrigin(base, 340).origin).toEqual({ cityId: 340 });
  });

  it('leaves a searched city alone', () => {
    expect(withProfileOrigin({ ...base, location: { districtId: 1, cityId: 654 } }, 340).origin).toBeUndefined();
  });

  it('never replaces the device location', () => {
    const device = { ...base, origin: { latitude: 6.85, longitude: 79.86 } };
    expect(withProfileOrigin(device, 340)).toBe(device);
  });

  it('does nothing without a profile city', () => {
    expect(withProfileOrigin(base, null)).toBe(base);
  });
});

describe('useDeviceLocation', () => {
  const setGeolocation = (impl: (ok: PositionCallback, fail: PositionErrorCallback) => void) =>
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: impl } });

  beforeEach(() => nearestCity.mockReset());

  it('rounds the position to about 100 m before it leaves the browser', async () => {
    setGeolocation((ok) => ok({ coords: { latitude: 6.851234, longitude: 79.865987 } } as GeolocationPosition));
    nearestCity.mockResolvedValue({ cityId: 340, districtId: 1, name: 'Dehiwala', districtName: 'Colombo', latitude: 6.85, longitude: 79.86, distanceKm: 0.2 });
    const { result } = renderHook(() => useDeviceLocation('en'));
    let located: Awaited<ReturnType<typeof result.current.locate>> = null;
    await act(async () => {
      located = await result.current.locate();
    });
    expect(nearestCity).toHaveBeenCalledWith({ latitude: 6.851, longitude: 79.866, locale: 'en' });
    expect(located).toMatchObject({ latitude: 6.851, longitude: 79.866, city: { cityId: 340 } });
  });

  it('reports a refused permission as "denied"', async () => {
    setGeolocation((_ok, fail) => fail({ code: 1 } as GeolocationPositionError));
    const { result } = renderHook(() => useDeviceLocation('en'));
    await act(async () => {
      await result.current.locate();
    });
    expect(result.current.error).toBe('denied');
    expect(nearestCity).not.toHaveBeenCalled();
  });

  it('reports a point outside the covered area as "outside"', async () => {
    setGeolocation((ok) => ok({ coords: { latitude: 51.5, longitude: -0.12 } } as GeolocationPosition));
    nearestCity.mockRejectedValue(new ApiError(422, 'outside'));
    const { result } = renderHook(() => useDeviceLocation('en'));
    await act(async () => {
      await result.current.locate();
    });
    await waitFor(() => expect(result.current.error).toBe('outside'));
  });
});

describe('circlePolygon', () => {
  it('draws a closed ring about the right size', () => {
    const ring = circlePolygon({ latitude: 7, longitude: 80 }, 10);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    // 10 km north is ~0.0904 degrees of latitude.
    const north = Math.max(...ring.map(([, lat]) => lat));
    expect(north - 7).toBeCloseTo(0.0904, 3);
  });
});
