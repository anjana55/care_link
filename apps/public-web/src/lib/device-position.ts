/**
 * Where this device is, for a check-in: asked once, at the moment of the
 * tap, and given up on after a few seconds. A device that cannot or may not
 * say resolves to nothing - the check-in goes ahead without it.
 */
export function devicePosition(timeoutMs = 8000): Promise<{ latitude?: number; longitude?: number; accuracyM?: number }> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve({});
  return new Promise((resolve) => {
    const giveUp = setTimeout(() => resolve({}), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(giveUp);
        resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracyM: p.coords.accuracy });
      },
      () => {
        clearTimeout(giveUp);
        resolve({});
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}
