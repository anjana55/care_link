import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import en from '../src/i18n/en.json';
import Find from '../app/(client)/find';
import { mapHtml, MAP_STYLE_URL } from '../src/search/CaregiverMap';
import { useDeviceLocation } from '../src/search/location';
import { AppProviders, serveApi } from '../test-utils/app';
import { mockRouter } from '../test-utils/router';
import { tokensFor } from '../test-utils/helpers';
import { tokenStore } from '@/api';

jest.mock('expo-router', () => require('../test-utils/router').expoRouterMock());

// The phone's location: granted unless a test says otherwise.
const mockLocation = {
  status: 'granted',
  coords: { latitude: 6.927079, longitude: 79.861244 },
};
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: mockLocation.status })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: mockLocation.coords })),
}));

// The map page: the test plays the page, telling the app it's ready and recording what it's asked to draw.
const mockMap: { props: Record<string, any> | null; drawn: string[] } = { props: null, drawn: [] };
jest.mock('react-native-webview', () => {
  const { createElement, forwardRef, useImperativeHandle } = require('react');
  const { View } = require('react-native');
  return {
    WebView: forwardRef((props: Record<string, unknown>, ref: unknown) => {
      mockMap.props = props;
      useImperativeHandle(ref, () => ({ injectJavaScript: (js: string) => mockMap.drawn.push(js) }));
      return createElement(View, { testID: props.testID });
    }),
  };
});
jest.mock('../src/care/PayhereSheet', () => ({ ...jest.requireActual('../src/care/PayhereSheet'), webViewAvailable: () => true }));

const TREE = [{ id: 1, name: 'Western', districts: [{ id: 5, name: 'Colombo' }] }];
const NEAREST = { cityId: 77, districtId: 5, name: 'Kollupitiya', districtName: 'Colombo', latitude: 6.91, longitude: 79.85, distanceKm: 1.2 };
const POINTS = [{ key: 'c77', latitude: 6.91, longitude: 79.85, name: 'Kollupitiya', count: 3, distanceKm: 1.2, precision: 'city' }];

function api(extra: Record<string, (body: Record<string, unknown>, query: Record<string, string>) => { status: number; body?: unknown }> = {}) {
  return serveApi({
    'GET /public/meta/search-config': () => ({ status: 200, body: { aiSearchEnabled: false } }),
    'GET /public/meta/skills': () => ({ status: 200, body: [] }),
    'GET /public/meta/locations/tree': () => ({ status: 200, body: TREE }),
    'GET /public/meta/coverage': () => ({ status: 200, body: [{ ...POINTS[0], distanceKm: null }] }),
    'POST /public/geo/nearest-city': () => ({ status: 200, body: NEAREST }),
    ...extra,
  });
}

const response = (total: number, radiusKm = 25, source = 'device', label: string | null = null) => ({
  items: [],
  page: 1,
  pageSize: 20,
  total,
  totalPages: total ? 1 : 0,
  origin: { latitude: 6.927, longitude: 79.861, source, label, radiusKm },
  mapPoints: total ? POINTS : [],
});

const show = () => render(<AppProviders><Find /></AppProviders>);

async function searchColombo() {
  await fireEvent.press(await screen.findByRole('radio', { name: en.careTypes.HOME_SHIFT }));
  await fireEvent.press(screen.getByRole('button', { name: en.normalSearch.district }));
  await fireEvent.press(await screen.findByRole('radio', { name: 'Colombo' }));
  await fireEvent.press(screen.getByRole('button', { name: en.normalSearch.submit }));
}

beforeEach(() => {
  mockRouter.reset();
  mockMap.props = null;
  mockMap.drawn = [];
  mockLocation.status = 'granted';
});

describe('use my location', () => {
  it('rounds the position to about 100 m, finds the city, and starts the next search from there', async () => {
    // Signed in, but the position goes without the session.
    await tokenStore.set(tokensFor('PATIENT_GUARDIAN', { patientId: 'p-1' }));
    const calls = api({ 'POST /public/search': () => ({ status: 200, body: response(3) }) });
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: `📍 ${en.map.useMyLocation}` }));

    expect(await screen.findByText(en.map.usingDevice.replace('{place}', 'Kollupitiya'))).toBeTruthy();
    const nearest = calls.find((c) => c.route === 'POST /public/geo/nearest-city')!;
    expect(nearest.body).toEqual({ latitude: 6.927, longitude: 79.861, locale: 'en' });
    expect(nearest.headers.Authorization).toBeUndefined();

    await searchColombo();
    await waitFor(() => expect(calls.some((c) => c.route === 'POST /public/search')).toBe(true));
    // The form named a district, so that stays; the phone is only where distances are measured from.
    expect(calls.find((c) => c.route === 'POST /public/search')!.body).toMatchObject({
      location: { districtId: 5 },
      origin: { latitude: 6.927, longitude: 79.861 },
      radiusKm: 25,
    });
    expect(await screen.findByText(en.map.summaryOther.replace('{count}', '3').replace('{radius}', '25').replace('{place}', en.map.placeDevice))).toBeTruthy();
    expect(screen.getByText(en.map.source.device)).toBeTruthy();
  });

  it('says so when the person says no, and asks nothing of the API', async () => {
    mockLocation.status = 'denied';
    const calls = api();
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: `📍 ${en.map.useMyLocation}` }));
    expect(await screen.findByText(en.map.errors.denied)).toBeTruthy();
    expect(calls.some((c) => c.route === 'POST /public/geo/nearest-city')).toBe(false);
  });

  it('says so when the phone is somewhere we don’t cover', async () => {
    api({ 'POST /public/geo/nearest-city': () => ({ status: 422, body: { message: 'Too far' } }) });
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: `📍 ${en.map.useMyLocation}` }));
    expect(await screen.findByText(en.map.errors.outside)).toBeTruthy();
  });

  it('says the phone can’t share its location in a build without the location module', async () => {
    serveApi({});
    const { result } = await renderHook(() => useDeviceLocation('en', () => null), { wrapper: AppProviders });
    let found: unknown;
    await act(async () => void (found = await result.current.locate()));
    expect(found).toBeNull();
    expect(result.current.error).toBe('unsupported');
  });
});

describe('how far to look', () => {
  it('searches again further out, and offers a wider search when nobody is in range', async () => {
    const calls = api({
      'POST /public/search': (body) => ({ status: 200, body: response(body.radiusKm === 50 ? 2 : 0, (body.radiusKm as number) ?? 25, 'searchCity', 'Colombo 03') }),
    });
    await show();
    await searchColombo();
    expect(await screen.findByText(en.map.noneWithin.replace('{radius}', '25'))).toBeTruthy();

    await fireEvent.press(screen.getByRole('link', { name: en.map.widen.replace('{km}', '50') }));
    expect(await screen.findByText(en.map.summaryOther.replace('{count}', '2').replace('{radius}', '50').replace('{place}', 'Colombo 03'))).toBeTruthy();
    expect(calls.filter((c) => c.route === 'POST /public/search').map((c) => c.body.radiusKm)).toEqual([undefined, 50]);
  });

  it('measures from a signed-in client’s profile city when the search names none', async () => {
    await tokenStore.set(tokensFor('PATIENT_GUARDIAN', { patientId: 'p-1' }));
    const calls = api({
      'GET /me/search-origin': () => ({ status: 200, body: { districtId: 5, cityId: 340 } }),
      'POST /public/search': () => ({ status: 200, body: response(1, 25, 'profileCity', 'Dehiwala') }),
    });
    await show();
    await waitFor(() => expect(calls.some((c) => c.route === 'GET /me/search-origin')).toBe(true));
    await searchColombo();
    await waitFor(() => expect(calls.some((c) => c.route === 'POST /public/search' && (c.body.origin as { cityId?: number })?.cityId === 340)).toBe(true));
  });
});

describe('the map', () => {
  it('shows where caregivers live before a search, and those around the search after', async () => {
    api({ 'POST /public/search': () => ({ status: 200, body: response(3) }) });
    await show();
    await screen.findByTestId('caregiver-map');
    await act(async () => mockMap.props!.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'ready' }) } }));
    await waitFor(() => expect(mockMap.drawn.some((js) => js.includes('"distanceKm":null'))).toBe(true));
    expect(mockMap.drawn.at(-1)).toContain(en.map.coverageOther.replace('{count}', '3').replace('{place}', 'Kollupitiya'));

    await searchColombo();
    await waitFor(() => expect(mockMap.drawn.at(-1)).toContain('"radiusKm":25'));
    expect(mockMap.drawn.at(-1)).toContain(en.map.pointOther.replace('{count}', '3').replace('{place}', 'Kollupitiya').replace('{km}', '1.2'));

    // Tapping a count says what it is.
    await act(async () => mockMap.props!.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'point', key: 'c77' }) } }));
    expect(screen.getByText(en.map.pointOther.replace('{count}', '3').replace('{place}', 'Kollupitiya').replace('{km}', '1.2'))).toBeTruthy();
  });

  it('says so when the map can’t load, and the list carries on', async () => {
    api();
    await show();
    await screen.findByTestId('caregiver-map');
    await act(async () => mockMap.props!.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'failed' }) } }));
    expect(await screen.findByText(en.map.failed)).toBeTruthy();
    expect(screen.queryByTestId('caregiver-map')).toBeNull();
  });

  it('draws the website’s map: MapLibre with OpenFreeMap, and opens no other pages', async () => {
    const html = mapHtml(MAP_STYLE_URL);
    expect(html).toContain('https://unpkg.com/maplibre-gl@6.16.0/dist/maplibre-gl.js');
    expect(html).toContain('"https://tiles.openfreemap.org/styles/positron"');
    api();
    await show();
    await screen.findByTestId('caregiver-map');
    expect(mockMap.props!.onShouldStartLoadWithRequest({ url: 'https://openfreemap.org/about' })).toBe(false);
    expect(mockMap.props!.onShouldStartLoadWithRequest({ url: 'https://tiles.openfreemap.org/' })).toBe(true);
  });
});
