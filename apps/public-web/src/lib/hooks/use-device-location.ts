'use client';

import { useCallback, useState } from 'react';
import type { NearestCity } from '@care-platform/shared';
import { ApiError } from '../api/client';
import { publicSearchApi } from '../api/public-search';

export type DeviceLocationError = 'denied' | 'unavailable' | 'outside' | 'unsupported';

/** The visitor's position plus the city it falls in. Coordinates are rounded to ~100 m before they leave the browser. */
export interface DeviceLocation {
  latitude: number;
  longitude: number;
  city: NearestCity;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 }),
  );
}

/**
 * "Use my location". Asks the browser only when called - never on page load.
 * The rounded position travels in the search request the visitor just made
 * (and the copy of it this browser keeps for "Back to results"); the server
 * uses it for that search and stores nothing.
 */
export function useDeviceLocation(locale: string) {
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<DeviceLocationError | null>(null);

  const locate = useCallback(async (): Promise<DeviceLocation | null> => {
    setError(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('unsupported');
      return null;
    }
    setLocating(true);
    try {
      let position: GeolocationPosition;
      try {
        position = await currentPosition();
      } catch (err) {
        setError((err as GeolocationPositionError)?.code === 1 ? 'denied' : 'unavailable');
        return null;
      }
      const latitude = round3(position.coords.latitude);
      const longitude = round3(position.coords.longitude);
      try {
        const city = await publicSearchApi.nearestCity({ latitude, longitude, locale });
        return { latitude, longitude, city };
      } catch (err) {
        setError(err instanceof ApiError && err.status === 422 ? 'outside' : 'unavailable');
        return null;
      }
    } finally {
      setLocating(false);
    }
  }, [locale]);

  return { locate, locating, error, clearError: () => setError(null) };
}
