/**
 * Just enough of maplibre-gl for jsdom, which has no WebGL. Markers are real
 * DOM: `addTo` appends the element to the map container, so tests can find
 * the count bubbles and service-area dots by their accessible names and
 * check what a visitor would be told.
 */
type Handler = () => void;

/** Every map created, newest last - so a test can inspect the one a component made. */
export const stubMaps: Map[] = [];

export class Map {
  private handlers: Record<string, Handler[]> = {};
  private sources: Record<string, { data: unknown; setData: (d: unknown) => void }> = {};
  readonly container: HTMLElement;
  /** The last bounds the map was framed to, and how - for assertions. */
  lastBounds: unknown = null;
  lastFitOptions: unknown = null;
  /** Mirrors MapLibre's handler: on when created with `cooperativeGestures: true`. */
  readonly cooperativeGestures = {
    enabled: false,
    enable: () => void (this.cooperativeGestures.enabled = true),
    disable: () => void (this.cooperativeGestures.enabled = false),
    isEnabled: () => this.cooperativeGestures.enabled,
  };

  constructor(options: { container: HTMLElement; cooperativeGestures?: boolean }) {
    this.container = options.container;
    this.cooperativeGestures.enabled = Boolean(options.cooperativeGestures);
    stubMaps.push(this);
    setTimeout(() => this.handlers.load?.forEach((h) => h()), 0);
  }
  on(event: string, handler: Handler) {
    (this.handlers[event] ??= []).push(handler);
    return this;
  }
  addControl() {
    return this;
  }
  addSource(id: string) {
    const source = { data: null as unknown, setData: (d: unknown) => (source.data = d) };
    this.sources[id] = source;
  }
  addLayer() {}
  getSource(id: string) {
    return this.sources[id];
  }
  getStyle() {
    return { layers: [] };
  }
  getLayoutProperty() {
    return undefined;
  }
  setLayoutProperty() {}
  isStyleLoaded() {
    return true;
  }
  fitBounds(bounds: unknown, options?: unknown) {
    this.lastBounds = bounds;
    this.lastFitOptions = options ?? null;
    return this;
  }
  remove() {}
}

export class Marker {
  private element: HTMLElement;
  constructor(options: { element: HTMLElement }) {
    this.element = options.element;
  }
  setLngLat(lngLat: [number, number]) {
    this.element.dataset.lngLat = lngLat.join(',');
    return this;
  }
  setPopup() {
    return this;
  }
  addTo(map: Map) {
    map.container.appendChild(this.element);
    return this;
  }
  remove() {
    this.element.remove();
  }
}

export class Popup {
  setText() {
    return this;
  }
}

export class NavigationControl {}

/** MapLibre 6: where the worker is loaded from (the component points it at public/). */
export let workerUrl = '';
export function setWorkerUrl(url: string) {
  workerUrl = url;
}
export function getVersion() {
  return '6.0.0-stub';
}
