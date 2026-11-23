import { useSyncExternalStore } from 'react';
import { api, ApiError, type AggregateRow, type GameForAdmin } from './shared';
import { fetchResults, type DayResult } from './resultsApi';

/**
 * One place for everything the Predictions page needs, outside the React tree.
 *
 * Why not component state: the page has two views (Board and Classic) and sits
 * on a dashboard whose tabs unmount their contents. With state in the
 * components, every view switch or tab change threw the data away and fetched
 * it again, and each view kept its own copy of the filters.
 *
 * Here the filters, the fetched rows and the chosen view live for as long as
 * the page is open, so both views read the same data and switching view or
 * tab costs no request. A fetch happens only when the data for the current
 * filters is missing, older than FRESH_MS, or the user presses Refresh.
 */

const FRESH_MS = 5 * 60_000;
const TZ = 'Asia/Kolkata';

export const dayString = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD

export interface Filters {
  gameId: string;
  agentIds: string[];
  date: string;
  percent: string;
}

export type View = 'board' | 'classic';

export interface Snapshot {
  filters: Filters;
  rows: AggregateRow[];
  singleAgent: boolean;
  loading: boolean;
  error: string | null;
  /** When the rows on screen were fetched; null until the first load. */
  fetchedAt: number | null;
  results: DayResult[];
  resultsError: string | null;
  games: GameForAdmin[];
  view: View;
}

// --- the per-browser default view -----------------------------------------

const DEFAULT_KEY = 'predictsim.predictionsDefaultView';

export function getDefaultView(): View {
  try {
    return localStorage.getItem(DEFAULT_KEY) === 'classic' ? 'classic' : 'board';
  } catch {
    return 'board'; // storage can be blocked; the page works without it
  }
}

export function setDefaultView(view: View) {
  try {
    localStorage.setItem(DEFAULT_KEY, view);
  } catch {
    /* ignore */
  }
  emit();
}

// --- state ------------------------------------------------------------------

interface DataEntry {
  rows: AggregateRow[];
  singleAgent: boolean;
  at: number;
}
interface ResultEntry {
  results: DayResult[];
  at: number;
}

let filters: Filters = { gameId: '', agentIds: [], date: dayString(0), percent: '' };
let view: View = getDefaultView();
let rows: AggregateRow[] = [];
let singleAgent = false;
let loading = true;
let error: string | null = null;
let fetchedAt: number | null = null;
let results: DayResult[] = [];
let resultsError: string | null = null;
let games: GameForAdmin[] = [];
let gamesLoaded = false;

const dataCache = new Map<string, DataEntry>();
const resultCache = new Map<string, ResultEntry>();
let dataSeq = 0;
let resultSeq = 0;
// A request already on its way for the same filters is reused, not repeated
// (two components mounting together, or React's dev-mode double effect).
let dataInflight: { key: string; p: Promise<void> } | null = null;
let resultInflight: { key: string; p: Promise<void> } | null = null;

const dataKey = (f: Filters) => JSON.stringify([f.gameId, f.date, [...f.agentIds].sort()]);
const resultKey = (f: Filters) => JSON.stringify([f.gameId, f.date]);

// --- external-store plumbing --------------------------------------------------

const listeners = new Set<() => void>();
let snapshot: Snapshot = build();

function build(): Snapshot {
  return { filters, rows, singleAgent, loading, error, fetchedAt, results, resultsError, games, view };
}
function emit() {
  snapshot = build();
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getSnapshot = () => snapshot;

// --- loading ------------------------------------------------------------------

/** Brings the screen up to date with the current filters. Reads the cache first;
 *  `force` (Refresh) skips it. Safe to call on every mount. */
export async function ensureData(force = false): Promise<void> {
  const key = dataKey(filters);
  const hit = dataCache.get(key);
  if (hit && !force && Date.now() - hit.at < FRESH_MS) {
    rows = hit.rows;
    singleAgent = hit.singleAgent;
    fetchedAt = hit.at;
    error = null;
    loading = false;
    emit();
    return;
  }

  if (!force && dataInflight?.key === key) return dataInflight.p;

  const id = ++dataSeq;
  loading = true;
  emit();
  const p = fetchData(id, key);
  dataInflight = { key, p };
  void p.finally(() => {
    if (dataInflight?.p === p) dataInflight = null;
  });
  return p;
}

async function fetchData(id: number, key: string): Promise<void> {
  try {
    const res = await api.aggregatePredictions({
      ...(filters.gameId ? { gameId: filters.gameId } : {}),
      ...(filters.date ? { date: filters.date } : {}),
      ...(filters.agentIds.length ? { agentIds: filters.agentIds } : {}),
    });
    // A slower earlier request must not overwrite a newer one.
    if (id !== dataSeq) return;
    const at = Date.now();
    dataCache.set(key, { rows: res.rows, singleAgent: res.singleAgent, at });
    rows = res.rows;
    singleAgent = res.singleAgent;
    fetchedAt = at;
    error = null;
  } catch (e) {
    if (id !== dataSeq) return;
    error = e instanceof ApiError ? e.message : String(e);
  } finally {
    if (id === dataSeq) {
      loading = false;
      emit();
    }
  }
}

/** Declared results for the selected day (and game). A blank date means "every
 *  day", which has no single result to show. */
export async function ensureResults(force = false): Promise<void> {
  if (!filters.date) {
    results = [];
    resultsError = null;
    emit();
    return;
  }
  const key = resultKey(filters);
  const hit = resultCache.get(key);
  if (hit && !force && Date.now() - hit.at < FRESH_MS) {
    results = hit.results;
    resultsError = null;
    emit();
    return;
  }
  if (!force && resultInflight?.key === key) return resultInflight.p;

  const id = ++resultSeq;
  const p = fetchResultsFor(id, key);
  resultInflight = { key, p };
  void p.finally(() => {
    if (resultInflight?.p === p) resultInflight = null;
  });
  return p;
}

async function fetchResultsFor(id: number, key: string): Promise<void> {
  try {
    const r = await fetchResults(filters.date, filters.gameId || undefined);
    if (id !== resultSeq) return;
    resultCache.set(key, { results: r, at: Date.now() });
    results = r;
    resultsError = null;
  } catch (e) {
    if (id !== resultSeq) return;
    results = [];
    resultsError = e instanceof Error ? e.message : String(e);
  }
  emit();
}

/** The game list only labels the dropdown, so it loads once per page visit. */
export async function ensureGames(): Promise<void> {
  if (gamesLoaded) return;
  gamesLoaded = true;
  try {
    games = await api.listGamesAsAdmin();
    emit();
  } catch {
    gamesLoaded = false; // try again next time; the filter degrades to "All games"
  }
}

/** Everything the page needs, from cache where it can. */
export function ensureAll() {
  void ensureGames();
  void ensureData();
  void ensureResults();
}

// --- actions --------------------------------------------------------------------

export function setFilters(patch: Partial<Filters>) {
  const before = filters;
  // Every day added together is rarely wanted, so the date is never blank: a
  // cleared date field goes back to today instead of widening the query.
  if (patch.date !== undefined && patch.date.trim() === '') patch = { ...patch, date: dayString(0) };
  filters = { ...filters, ...patch };
  emit();
  // The percentage is a display lens only, so it never refetches.
  if (dataKey(before) !== dataKey(filters)) void ensureData();
  if (resultKey(before) !== resultKey(filters)) void ensureResults();
}

export function refresh() {
  void ensureData(true);
  void ensureResults(true);
}

export function setView(v: View) {
  view = v;
  emit();
}

export function usePredictions(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}
