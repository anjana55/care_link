'use client';

import { useEffect } from 'react';

/**
 * Previous / next on a record's page, in the order of the list it was opened
 * from - with that list's search, filters and sort.
 *
 * Each list page leaves a "trail" for its kind of record: the ids on the page
 * it is showing, which page that is, and the API address it was loaded from.
 * The record page steps through those ids, and at either end of the page
 * loads the neighbouring page from the same address (only `page` changes),
 * so it can walk the whole list. Opened any other way, there is no trail with
 * that record in it, and the buttons don't show.
 *
 * Kept in sessionStorage: per browser tab, gone when the tab closes.
 */

export type TrailKind = 'caregivers' | 'clients' | 'requests' | 'bookings' | 'invoices' | 'payouts';

export interface Trail {
  /** The list's API address for `page`, e.g. /caregivers?status=ACTIVE&page=2&pageSize=20 */
  apiPath: string;
  ids: string[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ListPage {
  items: { id: string }[];
  page: number;
  pageSize: number;
  total: number;
  totalPages?: number;
}

const key = (kind: TrailKind) => `record-trail:${kind}`;

export function readTrail(kind: TrailKind): Trail | null {
  try {
    const raw = sessionStorage.getItem(key(kind));
    return raw ? (JSON.parse(raw) as Trail) : null;
  } catch {
    return null;
  }
}

export function saveTrail(kind: TrailKind, apiPath: string, list: ListPage) {
  const trail: Trail = {
    apiPath,
    ids: list.items.map((i) => i.id),
    page: list.page,
    pageSize: list.pageSize,
    total: list.total,
    totalPages: list.totalPages ?? Math.max(1, Math.ceil(list.total / Math.max(1, list.pageSize))),
  };
  try {
    sessionStorage.setItem(key(kind), JSON.stringify(trail));
  } catch {
    // Storage blocked: the record pages simply show no previous / next.
  }
}

/** The same list address for another page. */
export function pagePath(apiPath: string, page: number): string {
  const [path, query = ''] = apiPath.split('?');
  const params = new URLSearchParams(query);
  params.set('page', String(page));
  return `${path}?${params.toString()}`;
}

/** For a list page: remember what it is showing, whenever that changes. */
export function useRecordTrail(kind: TrailKind, apiPath: string, list: ListPage | undefined) {
  useEffect(() => {
    if (list) saveTrail(kind, apiPath, list);
  }, [kind, apiPath, list]);
}
