// A small client of its own rather than a method on the shared `api`: the
// shared client is vendored from the monorepo and overwritten on every sync,
// and this call only exists in this app.
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
const PORTAL: string | undefined = import.meta.env.VITE_PORTAL;

export interface DayResult {
  gameId: string;
  gameName: string;
  date: string;
  openPana: string | null;
  closePana: string | null;
  /** Ank: last digit of the pana's digit sum, derived server-side. */
  openSingle: number | null;
  closeSingle: number | null;
}

/** Declared results for one day (optionally one game). */
export async function fetchResults(date: string, gameId?: string): Promise<DayResult[]> {
  const qs = new URLSearchParams({ date, ...(gameId ? { gameId } : {}) });
  const res = await fetch(`${BASE_URL}/games/results?${qs}`, {
    credentials: 'include',
    headers: PORTAL ? { 'X-Portal': PORTAL } : undefined,
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const raw = payload?.message;
    throw new Error(Array.isArray(raw) ? raw.join(', ') : (raw ?? res.statusText));
  }
  return payload as DayResult[];
}
