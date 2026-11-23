import { useSyncExternalStore } from 'react';
import { api, ApiError, type SettlementRow } from './shared';

/**
 * State for the Settlements page, outside the React tree, for the same reason
 * as predictionsStore: the page has two views (Bill and Classic) on a dashboard
 * whose tabs unmount their contents, so component state meant every view
 * switch or tab change fetched everything again and each view kept its own
 * filters. Here filters, data and the Admin's working figures (commission,
 * adjustments, carried-over balance) survive both, and a request goes out only
 * for data that is missing, older than FRESH_MS, or on Refresh.
 */

const FRESH_MS = 5 * 60_000;
const TZ = 'Asia/Kolkata';

export const dayString = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString('en-CA', { timeZone: TZ });

export type View = 'bill' | 'classic';

export interface Filters {
  /** Blank asks for the latest settled day; the server says which day that was. */
  date: string;
  agentId: string;
  /** Percent of the day's bet taken as commission. A display lens, never stored. */
  commission: string;
}

export interface Adjustment {
  id: number;
  title: string;
  sign: 1 | -1;
  amount: string;
}

export interface Carry {
  type: 'due' | 'payment';
  amount: string;
}

export interface Snapshot {
  filters: Filters;
  rows: SettlementRow[];
  /** The day the rows are for (the latest settled day when none was asked for). */
  shownDate: string | null;
  loading: boolean;
  error: string | null;
  fetchedAt: number | null;
  view: View;
  adjustments: Record<string, Adjustment[]>;
  carry: Record<string, Carry>;
}

// --- per-browser default view ---------------------------------------------

const DEFAULT_KEY = 'predictsim.settlementsDefaultView';

export function getDefaultView(): View {
  try {
    return localStorage.getItem(DEFAULT_KEY) === 'classic' ? 'classic' : 'bill';
  } catch {
    return 'bill'; // storage can be blocked; the page works without it
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

let filters: Filters = { date: '', agentId: '', commission: '' };
let view: View = getDefaultView();
let rows: SettlementRow[] = [];
let shownDate: string | null = null;
let loading = true;
let error: string | null = null;
let fetchedAt: number | null = null;
let adjustments: Record<string, Adjustment[]> = {};
let carry: Record<string, Carry> = {};
let nextAdjId = 1;

const cache = new Map<string, { rows: SettlementRow[]; date: string | null; at: number }>();
let seq = 0;
let inflight: { key: string; p: Promise<void> } | null = null;

const keyOf = (f: Filters) => JSON.stringify([f.date, f.agentId]);

const listeners = new Set<() => void>();
let snapshot: Snapshot = build();
function build(): Snapshot {
  return { filters, rows, shownDate, loading, error, fetchedAt, view, adjustments, carry };
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

export async function ensureData(force = false): Promise<void> {
  const key = keyOf(filters);
  const hit = cache.get(key);
  if (hit && !force && Date.now() - hit.at < FRESH_MS) {
    rows = hit.rows;
    shownDate = hit.date;
    fetchedAt = hit.at;
    error = null;
    loading = false;
    emit();
    return;
  }
  if (!force && inflight?.key === key) return inflight.p;

  const id = ++seq;
  loading = true;
  emit();
  const f = filters;
  const p = (async () => {
    try {
      const res = await api.settlements({
        ...(f.date ? { date: f.date } : {}),
        ...(f.agentId ? { agentId: f.agentId } : {}),
      });
      if (id !== seq) return; // a newer request owns the screen
      const at = Date.now();
      cache.set(key, { rows: res.rows, date: res.date, at });
      rows = res.rows;
      shownDate = res.date;
      fetchedAt = at;
      error = null;
    } catch (e) {
      if (id !== seq) return;
      error = e instanceof ApiError ? e.message : String(e);
    } finally {
      if (id === seq) {
        loading = false;
        emit();
      }
    }
  })();
  inflight = { key, p };
  void p.finally(() => {
    if (inflight?.p === p) inflight = null;
  });
  return p;
}

// --- actions --------------------------------------------------------------------

export function setFilters(patch: Partial<Filters>) {
  const before = filters;
  filters = { ...filters, ...patch };
  emit();
  // Commission is a display lens and never refetches.
  if (keyOf(before) !== keyOf(filters)) void ensureData();
}

export function refresh() {
  void ensureData(true);
}

export function setView(v: View) {
  view = v;
  emit();
}

export function addAdjustment(agentId: string) {
  adjustments = { ...adjustments, [agentId]: [...(adjustments[agentId] ?? []), { id: nextAdjId++, title: '', sign: 1, amount: '' }] };
  emit();
}
export function updateAdjustment(agentId: string, id: number, patch: Partial<Adjustment>) {
  adjustments = { ...adjustments, [agentId]: (adjustments[agentId] ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a)) };
  emit();
}
export function removeAdjustment(agentId: string, id: number) {
  adjustments = { ...adjustments, [agentId]: (adjustments[agentId] ?? []).filter((a) => a.id !== id) };
  emit();
}
export function setCarry(agentId: string, patch: Partial<Carry>) {
  const cur = carry[agentId] ?? { type: 'due' as const, amount: '' };
  carry = { ...carry, [agentId]: { ...cur, ...patch } };
  emit();
}

export function usePageSettlements(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}
