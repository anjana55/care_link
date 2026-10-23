'use client';

// NOTE: this file is duplicated verbatim in apps/web (the staff portal), like
// tailwind.config.js. Change both together. It takes every visible string as a
// prop so it carries no dependency on either app's dictionaries.

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, LngLatBoundsLike, Map as MapLibreMap, Marker } from 'maplibre-gl';
import type { CaregiverHomeLocation, GeoPoint, MapCityPoint, SearchOrigin, ServiceAreaCity } from '@care-platform/shared';

/**
 * OpenFreeMap: open-source vector tiles, no API key, no usage limits, MIT
 * licensed and self-hostable. Override per deployment (e.g. a self-hosted
 * tile server for a white-label customer) with NEXT_PUBLIC_MAP_STYLE_URL.
 */
export const MAP_STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron';

export interface CaregiverMapLabels {
  /** Accessible name of the whole map. */
  map: string;
  /** Marker title for the origin ("You are here" / "Client"). */
  origin: string;
  /** Title and popup text for one grouped point ("3 caregivers in Negombo, 4.2 km"). */
  point: (point: MapCityPoint) => string;
  /** Marker title for a highlighted caregiver's service-area city. */
  serviceCity: (city: ServiceAreaCity) => string;
  /** Shown when the map cannot load (offline, tiles blocked). */
  failed: string;
}

export interface CaregiverMapHighlight {
  home: CaregiverHomeLocation | null;
  serviceArea: ServiceAreaCity[];
}

interface CaregiverMapProps {
  origin: SearchOrigin | null;
  points: MapCityPoint[];
  highlight?: CaregiverMapHighlight | null;
  labels: CaregiverMapLabels;
  /** Picks which name the basemap's place labels show. */
  locale?: string;
  className?: string;
}

/** A theme colour from the white-label CSS variables ("R G B" channels), as rgb(). */
function themeColor(variable: string, fallback: string): string {
  if (typeof window === 'undefined') return `rgb(${fallback})`;
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return `rgb(${value || fallback})`;
}

/** A polygon approximating a circle of `radiusKm` around `center` - good to well under 1% at Sri Lanka's latitude. */
export function circlePolygon(center: GeoPoint, radiusKm: number, steps = 64): [number, number][] {
  const latDeg = radiusKm / 110.574;
  const lngDeg = radiusKm / (111.32 * Math.cos((center.latitude * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * 2 * Math.PI;
    ring.push([center.longitude + lngDeg * Math.cos(angle), center.latitude + latDeg * Math.sin(angle)]);
  }
  return ring;
}

/** The smallest box holding every given point, padded so a lone point is not zoomed to street level. */
export function boundsOf(points: GeoPoint[]): LngLatBoundsLike | null {
  if (!points.length) return null;
  let [minLng, minLat, maxLng, maxLat] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of points) {
    minLng = Math.min(minLng, p.longitude);
    maxLng = Math.max(maxLng, p.longitude);
    minLat = Math.min(minLat, p.latitude);
    maxLat = Math.max(maxLat, p.latitude);
  }
  const pad = 0.02;
  return [
    [minLng - pad, minLat - pad],
    [maxLng + pad, maxLat + pad],
  ];
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Caregivers around a search origin, at city level.
 *
 * Every matching caregiver appears as part of a count on the city they live
 * in (never an address, never an individual pin), the origin carries the
 * search radius as a circle, and a highlighted caregiver adds lines from
 * where they live to each city they will travel to work in.
 */
export function CaregiverMap({ origin, points, highlight, labels, locale = 'en', className }: CaregiverMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const lib = useRef<typeof import('maplibre-gl') | null>(null);
  const markers = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  // Read through a ref so a parent re-creating its label functions on every
  // render does not redraw the markers and re-frame a map the visitor has panned.
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

  // Create the map once. MapLibre touches `window`, so it is loaded only in the browser.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const maplibre = await import('maplibre-gl');
        if (cancelled || !container.current) return;
        lib.current = maplibre;
        const instance = new maplibre.Map({
          container: container.current,
          style: MAP_STYLE_URL,
          center: [80.7, 7.8],
          zoom: 6.5,
          attributionControl: { compact: true },
          cooperativeGestures: true,
        });
        instance.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
        instance.on('load', () => {
          if (cancelled) return;
          const accent = themeColor('--color-accent', '47 122 132');
          instance.addSource('radius', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          instance.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': accent, 'fill-opacity': 0.08 } });
          instance.addLayer({ id: 'radius-line', type: 'line', source: 'radius', paint: { 'line-color': accent, 'line-width': 1.5, 'line-opacity': 0.6 } });
          instance.addSource('reach', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          instance.addLayer({
            id: 'reach-line',
            type: 'line',
            source: 'reach',
            paint: { 'line-color': accent, 'line-width': 2, 'line-dasharray': [2, 2] },
          });
          setReady(true);
        });
        instance.on('error', () => {
          // A failed tile now and then is normal; a style that never loads is not.
          if (!instance.isStyleLoaded()) setFailed(true);
        });
        map.current = instance;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      markers.current.forEach((m) => m.remove());
      markers.current = [];
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Basemap place names in the visitor's language where the tiles have them.
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    for (const layer of instance.getStyle().layers ?? []) {
      if (layer.type !== 'symbol' || !instance.getLayoutProperty(layer.id, 'text-field')) continue;
      instance.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', `name:${locale}`], ['get', 'name:latin'], ['get', 'name']]);
    }
  }, [ready, locale]);

  // Everything that depends on the data: redrawn whenever it changes.
  useEffect(() => {
    const instance = map.current;
    const maplibre = lib.current;
    if (!ready || !instance || !maplibre) return;
    const text = labelsRef.current;

    markers.current.forEach((m) => m.remove());
    markers.current = [];

    const radius = instance.getSource('radius') as GeoJSONSource | undefined;
    radius?.setData({
      type: 'FeatureCollection',
      features: origin
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circlePolygon(origin, origin.radiusKm)] } }]
        : [],
    });

    const add = (element: HTMLElement, at: GeoPoint, popup?: string) => {
      const marker = new maplibre.Marker({ element }).setLngLat([at.longitude, at.latitude]);
      if (popup) marker.setPopup(new maplibre.Popup({ offset: 14, closeButton: false }).setText(popup));
      marker.addTo(instance);
      markers.current.push(marker);
    };

    for (const point of points) {
      const el = document.createElement('button');
      el.type = 'button';
      const title = text.point(point);
      el.title = title;
      el.setAttribute('aria-label', title);
      el.className =
        'flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-white bg-brand px-1.5 text-xs font-semibold text-white shadow-md focus:outline-none focus:ring-2 focus:ring-offset-1';
      el.textContent = String(point.count);
      add(el, point, title);
    }

    if (highlight) {
      const reach = instance.getSource('reach') as GeoJSONSource | undefined;
      const home = highlight.home;
      reach?.setData({
        type: 'FeatureCollection',
        features: home
          ? highlight.serviceArea.map((city) => ({
              type: 'Feature' as const,
              properties: {},
              geometry: { type: 'LineString' as const, coordinates: [[home.longitude, home.latitude], [city.longitude, city.latitude]] },
            }))
          : [],
      });
      if (home) {
        const ring = document.createElement('div');
        ring.className = 'pointer-events-none h-11 w-11 rounded-full border-[3px] border-accent bg-accent/10';
        ring.setAttribute('aria-hidden', 'true');
        add(ring, home);
      }
      for (const city of highlight.serviceArea) {
        const el = document.createElement('div');
        const title = text.serviceCity(city);
        el.title = title;
        el.setAttribute('role', 'img');
        el.setAttribute('aria-label', title);
        el.className = 'h-3.5 w-3.5 rounded-full border-2 border-white bg-accent shadow';
        add(el, city, title);
      }
    } else {
      (instance.getSource('reach') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] });
    }

    if (origin) {
      const el = document.createElement('div');
      el.title = text.origin;
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', text.origin);
      el.className = 'relative h-5 w-5';
      el.innerHTML =
        '<span class="absolute inset-0 animate-ping rounded-full bg-accent/40 motion-reduce:hidden"></span><span class="absolute inset-0.5 rounded-full border-2 border-white bg-accent shadow"></span>';
      add(el, origin);
    }

    // Frame the highlighted caregiver when there is one, otherwise the search radius.
    const frame: GeoPoint[] = highlight
      ? [...(origin ? [origin] : []), ...(highlight.home ? [highlight.home] : []), ...highlight.serviceArea]
      : origin
        ? circlePolygon(origin, origin.radiusKm, 8).map(([longitude, latitude]) => ({ latitude, longitude }))
        : points;
    const bounds = boundsOf(frame);
    if (bounds) instance.fitBounds(bounds, { padding: 32, maxZoom: 12, animate: !reducedMotion() });
  }, [ready, origin, points, highlight]);

  return (
    <div className={className ?? 'relative h-72 w-full overflow-hidden rounded-lg border border-border bg-paper sm:h-96'}>
      <div ref={container} className="absolute inset-0" role="region" aria-label={labels.map} />
      {failed && (
        <p role="status" className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-ink/60">
          {labels.failed}
        </p>
      )}
    </div>
  );
}
