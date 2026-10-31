import { useCallback, useState } from 'react';
import { roundCoordinate, type DeviceLocation, type DeviceLocationError, type NearestCity } from '@care-platform/shared';
import { api, ApiError } from '@/api';

type LocationModule = typeof import('expo-location');

/**
 * expo-location, or null in a build made before it was added (it's a native
 * module): "Use my location" then says the phone can't share it.
 */
function locationModule(): LocationModule | null {
  try {
    return require('expo-location') as LocationModule;
  } catch {
    return null;
  }
}

/**
 * "Use my location", as on the website. Asks the phone only when pressed -
 * never on start-up - for a rough position, rounds it to about 100 m, and asks
 * the API which city that is. The position travels only in the search the
 * person then runs; nothing is stored.
 */
export function useDeviceLocation(locale: string, load: () => LocationModule | null = locationModule) {
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<DeviceLocationError | null>(null);

  const locate = useCallback(async (): Promise<DeviceLocation | null> => {
    setError(null);
    const Location = load();
    if (!Location) {
      setError('unsupported');
      return null;
    }
    setLocating(true);
    try {
      let coords: { latitude: number; longitude: number };
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setError('denied');
          return null;
        }
        ({ coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      } catch {
        setError('unavailable');
        return null;
      }
      const latitude = roundCoordinate(coords.latitude);
      const longitude = roundCoordinate(coords.longitude);
      try {
        // A POST, so the coordinates never appear in a URL or an access log.
        const city = await api.request<NearestCity>('/public/geo/nearest-city', {
          method: 'POST',
          body: { latitude, longitude, locale },
          anonymous: true,
        });
        return { latitude, longitude, city };
      } catch (err) {
        setError(err instanceof ApiError && err.status === 422 ? 'outside' : 'unavailable');
        return null;
      }
    } finally {
      setLocating(false);
    }
  }, [locale, load]);

  return { locate, locating, error, clearError: () => setError(null) };
}
