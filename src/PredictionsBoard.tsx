import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  CopyButton,
  Empty,
  PREDICTION_TYPE_LABEL,
  RefreshButton,
  type PredictionType,
  type UserSummary,
} from './shared';
import { dayString, ensureAll, refresh, setFilters, usePredictions } from './predictionsStore';
import './predictionsBoard.css';

/**
 * The Admin's book of predictions, laid out the way the matka dashboard's
 * data-tables page does it: a row of control cards (totals + percentage,
 * filters, date) over a grid of compact tables, one per bet type. Each table
 * is just Number and Amount with its own Total and a copy button.
 *
 * Rules carried over from the card this replaces:
 * - A picked number is a fixed-width code, so numbers sort as strings.
 * - The odds column only appears when exactly one agent is in scope; the
 *   server decides that (`singleAgent`).
 * - The percentage is a display lens only. Nothing is stored or re-fetched.
 *
 * There is no Date column. The page shows one day at a time (today by default,
 * with Today / Yesterday buttons); the date is never blank, so a number appears
 * once with that day's combined amount.
 */

const TZ = 'Asia/Kolkata';

interface Line {
  number: string;
  bets: number;
  amount: number; // before the percentage cut
  odds: number | null;
}

type SortKey = 'number' | 'amount';

// No thousands separators, as on the dashboard's data-tables page.
const rowsKey = (lines: Line[]) => lines.length;
const fmt = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, useGrouping: false }).format(n);

// First digit of a Jodi ("05" -> 0, "47" -> 4).
const jodiDigit = (n: string) => Math.min(9, Math.max(0, Math.floor((parseInt(n, 10) || 0) / 10)));

function TypeTable({
  typeId,
  lines,
  pct,
  showOdds,
  hitDigit,
  winner,
}: {
  typeId: PredictionType;
  lines: Line[];
  pct: number;
  showOdds: boolean;
  /** The declared open ank: the Jodi group starting with it is highlighted. */
  hitDigit: number | null;
  /** The declared winning number for this (non-Jodi) type, as the picked-number string. */
  winner: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sortKey, setSortKey] = useState<SortKey>('number');
  const [asc, setAsc] = useState(true);

  const cut = (amount: number) => (pct > 0 ? Math.round(amount * (1 - pct / 100)) : amount);
  const shown = useMemo(() => lines.map((l) => ({ ...l, amount: cut(l.amount) })), [lines, pct]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = shown.reduce((sum, l) => sum + l.amount, 0);
  const betTotal = shown.reduce((sum, l) => sum + l.bets, 0);

  const sorted = useMemo(() => {
    const copy = [...shown];
    copy.sort((a, b) => {
      const c =
        sortKey === 'number'
          ? a.number < b.number ? -1 : a.number > b.number ? 1 : 0
          : a.amount - b.amount;
      return asc ? c : -c;
    });
    return copy;
  }, [shown, sortKey, asc]);

  function toggle(key: SortKey) {
    if (sortKey === key) setAsc(!asc);
    else {
      setSortKey(key);
      setAsc(key === 'number');
    }
  }
  const arrow = (key: SortKey) => (sortKey === key ? (asc ? ' ▲' : ' ▼') : '');

  const isJodi = typeId === 'JODI';

  // Bring the winning row into view inside this table's scroll box.
  useEffect(() => {
    const box = scrollRef.current;
    const row = box?.querySelector<HTMLElement>('.pb-hit, .pb-hit-group');
    if (!box || !row) return;
    box.scrollTop += row.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 3;
  }, [winner, hitDigit, rowsKey(lines)]); // eslint-disable-line react-hooks/exhaustive-deps
  // Jodi rows are grouped by first digit with a subtotal, as the mdash page
  // does — only while sorted by number, since a group means nothing otherwise.
  const grouped = isJodi && sortKey === 'number' && asc;

  const copyAll = () => sorted.map((l) => `${l.number}-${l.amount}`).join('\n');
  const copyJodiGroup = (digit: number) => {
    const amounts = new Map(shown.map((l) => [l.number.padStart(2, '0'), l.amount]));
    return Array.from({ length: 10 }, (_, i) => {
      const key = `${digit}${i}`;
      return `${key}-${amounts.get(key) ?? 0}`;
    }).join('\n');
  };

  type Row = { kind: 'line'; line: Line } | { kind: 'group'; digit: number; total: number };
  const rows: Row[] = [];
  if (grouped) {
    let current = -1;
    let sum = 0;
    for (const l of sorted) {
      const d = jodiDigit(l.number);
      if (current !== -1 && d !== current) rows.push({ kind: 'group', digit: current, total: sum }), (sum = 0);
      current = d;
      sum += l.amount;
      rows.push({ kind: 'line', line: l });
    }
    if (current !== -1) rows.push({ kind: 'group', digit: current, total: sum });
  } else {
    for (const l of sorted) rows.push({ kind: 'line', line: l });
  }

  return (
    <section className="pb-table">
      <header className="pb-table__head">
        <h3>{PREDICTION_TYPE_LABEL[typeId]}</h3>
        <span className="pb-chip" title={`${betTotal} bets`}>
          Total: {fmt(total)}
        </span>
        {isJodi && hitDigit !== null && (
          <span className="pb-chip pb-chip--hit">
            Ank {hitDigit}
            <button
              type="button"
              className="pb-icon"
              title={`Copy ${hitDigit}0–${hitDigit}9`}
              onClick={() => void navigator.clipboard?.writeText(copyJodiGroup(hitDigit))}
            >
              ⧉
            </button>
          </span>
        )}
        <CopyButton getText={copyAll} />
      </header>
      <div className="pb-table__scroll" ref={scrollRef}>
        <table className="pb-grid">
          <thead>
            <tr>
              <th>
                <button type="button" className="pb-sort" onClick={() => toggle('number')}>
                  Number{arrow('number')}
                </button>
              </th>
              <th className="pb-num">
                <button type="button" className="pb-sort" onClick={() => toggle('amount')}>
                  Amount{arrow('amount')}
                </button>
              </th>
              {showOdds && <th className="pb-num">Odds</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) =>
              r.kind === 'group' ? (
                <tr key={`g${r.digit}`} className={`pb-group ${isJodi && r.digit === hitDigit ? 'pb-hit-group' : ''}`}>
                  <td>
                    {r.digit} Total{' '}
                    <button
                      type="button"
                      className="pb-icon"
                      title={`Copy ${r.digit}0–${r.digit}9`}
                      onClick={() => void navigator.clipboard?.writeText(copyJodiGroup(r.digit))}
                    >
                      ⧉
                    </button>
                  </td>
                  <td className="pb-num">{fmt(r.total)}</td>
                  {showOdds && <td />}
                </tr>
              ) : (
                <tr key={r.line.number} className={
                    isJodi ? (jodiDigit(r.line.number) === hitDigit ? 'pb-hit' : undefined) : winner !== null && r.line.number === winner ? 'pb-hit' : undefined
                  }
                >
                  <td className="pb-strong">{r.line.number} —</td>
                  <td className="pb-num">{fmt(r.line.amount)}</td>
                  {showOdds && <td className="pb-num">{r.line.odds === null ? '—' : `${r.line.odds}x`}</td>}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function PredictionsBoard({ agents }: { agents: UserSummary[] }) {
  // Filters, rows and results all come from the shared store, so Board and
  // Classic show the same data and switching view or tab costs no request.
  const { filters, rows, singleAgent, loading, error, fetchedAt, results, resultsError, pnl, pnlError, games } = usePredictions();
  const { gameId, agentIds, date, percent } = filters;
  const setGameId = (v: string) => setFilters({ gameId: v });
  const setAgentIds = (v: string[]) => setFilters({ agentIds: v });
  const setDate = (v: string) => setFilters({ date: v });
  const setPercent = (v: string) => setFilters({ percent: v });
  const load = refresh;

  useEffect(() => {
    ensureAll(); // from cache when it is still fresh
  }, []);

  const updated = fetchedAt
    ? new Date(fetchedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
    : null;

  const pct = Number(percent);
  const pctOk = percent.trim() !== '' && Number.isFinite(pct) && pct >= 0 && pct <= 100;
  const pctUse = pctOk ? pct : 0;

  // One table per bet type, numbers merged across the selected games and days.
  const byType = useMemo(() => {
    const types = new Map<PredictionType, Map<string, Line>>();
    for (const r of rows) {
      let m = types.get(r.typeId);
      if (!m) types.set(r.typeId, (m = new Map()));
      const l = m.get(r.pickedNumber);
      if (l) {
        l.bets += r.betCount;
        l.amount += r.totalStake;
      } else {
        m.set(r.pickedNumber, { number: r.pickedNumber, bets: r.betCount, amount: r.totalStake, odds: r.odds });
      }
    }
    return [...types.entries()].map(([typeId, m]): [PredictionType, Line[]] => [typeId, [...m.values()]]);
  }, [rows]);

  const grandRaw = rows.reduce((s, r) => s + r.totalStake, 0);
  const grandCut = byType.reduce(
    (s, [, lines]) => s + lines.reduce((x, l) => x + (pctUse > 0 ? Math.round(l.amount * (1 - pctUse / 100)) : l.amount), 0),
    0,
  );
  const grandBets = rows.reduce((s, r) => s + r.betCount, 0);

  // With one game selected there is exactly one result to highlight against.
  const single = gameId ? results.find((r) => r.gameId === gameId) ?? null : null;
  const hitDigit = single?.openSingle ?? null;
  const declared = results.filter((r) => r.openPana || r.closePana);

  // Your P&L for this game and day, at the rate you give your agents.
  const book = pnl;
  const gameName = gameId ? games.find((g) => g.id === gameId)?.name : undefined;

  // The declared winning number of each non-Jodi type, as a picked-number string.
  // Jodi is highlighted by its open-ank group instead; the Sangams have no single winner.
  const winnerFor = (typeId: PredictionType): string | null => {
    if (!single) return null;
    const s = (n: number | null) => (n === null ? null : String(n));
    switch (typeId) {
      case 'OPEN_SINGLE':
        return s(single.openSingle);
      case 'CLOSE_SINGLE':
        return s(single.closeSingle);
      case 'OPEN_SINGLE_PANA':
      case 'OPEN_DOUBLE_PANA':
      case 'OPEN_TRIPLE_PANA':
        return single.openPana;
      case 'CLOSE_SINGLE_PANA':
      case 'CLOSE_DOUBLE_PANA':
      case 'CLOSE_TRIPLE_PANA':
        return single.closePana;
      default:
        return null;
    }
  };

  const toggleAgent = (id: string) =>
    setAgentIds(agentIds.includes(id) ? agentIds.filter((x) => x !== id) : [...agentIds, id]);

  return (
    <div className="pb">
      <div className="pb-controls">
        <div className="pb-card">
          <p className="pb-card__title">Totals</p>
          <div className="pb-metric">{fmt(grandRaw)}</div>
          <div className="pb-sub">
            {grandBets.toLocaleString()} bets · {byType.length} bet type{byType.length === 1 ? '' : 's'}
            {updated && ` · updated ${updated}`}
          </div>
          <div className="pb-pct">
            <input
              className="input"
              inputMode="decimal"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              placeholder="Apply percentage"
              aria-invalid={percent.trim() !== '' && !pctOk}
            />
            <span>%</span>
          </div>
          <div className="pb-sub">
            {pctOk && pctUse > 0 ? `After −${pctUse}%: ` : 'After percentage: '}
            <strong>{fmt(grandCut)}</strong>
          </div>
          {percent.trim() !== '' && !pctOk && <div className="pb-bad">Must be between 0 and 100.</div>}
        </div>

        <div className="pb-card">
          <p className="pb-card__title">Filters</p>
          <label className="pb-label">Game</label>
          <select className="select" value={gameId} onChange={(e) => setGameId(e.target.value)}>
            <option value="">All games</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <div className="pb-label pb-label--row">
            <span>Agents</span>
            <RefreshButton onClick={() => void load()} refreshing={loading} />
          </div>
          <div className="pb-chips">
            {agents.length === 0 && <span className="pb-sub">No agents yet.</span>}
            {agents.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`pb-agent ${agentIds.includes(a.id) ? 'is-on' : ''}`}
                onClick={() => toggleAgent(a.id)}
              >
                {a.username}
              </button>
            ))}
          </div>
          <div className="pb-sub">
            {agentIds.length === 0
              ? 'None selected — all your agents.'
              : singleAgent
                ? 'One agent selected — odds shown.'
                : 'Pick exactly one agent to see odds.'}
          </div>
        </div>

        <div className="pb-card">
          <p className="pb-card__title">Date</p>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <div className="pb-buttons">
            <Button size="sm" onClick={() => setDate(dayString(0))}>
              Today
            </Button>
            <Button size="sm" onClick={() => setDate(dayString(-1))}>
              Yesterday
            </Button>
          </div>
          <div className="pb-sub">Showing {date}.</div>
        </div>

        <div className="pb-card">
          <p className="pb-card__title">Result</p>
          {!date ? (
            <span className="pb-sub">Pick a day to see its results.</span>
          ) : resultsError ? (
            <span className="pb-bad">{resultsError}</span>
          ) : single ? (
            <>
              <div className="pb-result">
                {(['Open', 'Close'] as const).map((side) => {
                  const pana = side === 'Open' ? single.openPana : single.closePana;
                  const ank = side === 'Open' ? single.openSingle : single.closeSingle;
                  return (
                    <div className="pb-cell" key={side}>
                      <span className="pb-cell__label">{side}</span>
                      <span className="pb-cell__pana">{pana ?? '—'}</span>
                      <span className="pb-cell__ank">{ank ?? '—'}</span>
                    </div>
                  );
                })}
              </div>
              <div className="pb-sub">
                {single.openPana || single.closePana
                  ? 'Winning numbers are highlighted in each table below'
                  : 'No result declared for this game yet.'}
              </div>
            </>
          ) : declared.length > 0 ? (
            <div className="pb-result-list">
              {declared.map((r) => (
                <div className="pb-result-row" key={r.gameId}>
                  <span>{r.gameName}</span>
                  <span className="pb-strong">
                    {r.openPana ?? '—'}-{r.openSingle ?? '—'}
                    {r.closePana ? ` / ${r.closePana}-${r.closeSingle}` : ''}
                  </span>
                </div>
              ))}
              <div className="pb-sub">Pick a game to see its result and highlight the Jodi.</div>
            </div>
          ) : (
            <span className="pb-sub">No result declared for {gameId ? 'this game' : 'any game'} on this day.</span>
          )}
        </div>

        <div className="pb-card">
          <p className="pb-card__title">P&amp;L{gameName ? ` · ${gameName}` : ' · all games'}</p>
          {pnlError ? (
            <span className="pb-bad">{pnlError}</span>
          ) : !book || book.bets === 0 ? (
            <span className="pb-sub">No bets on this day.</span>
          ) : (
            <>
              <div className="pb-pnl">
                <div><span>Stake</span><strong>{fmt(book.stake)}</strong></div>
                <div><span>Paid</span><strong>{fmt(book.paid)}</strong></div>
                <div className={book.net < 0 ? 'is-neg' : 'is-pos'}><span>Net</span><strong>{fmt(book.net)}</strong></div>
              </div>
              <div className="pb-sub">
                At the rate you give your agents.
                {book.pending > 0 ? ` ${book.pending} bets still open — not counted yet.` : ' All bets graded.'}
              </div>
            </>
          )}
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {loading ? (
        <Empty>Loading…</Empty>
      ) : byType.length === 0 ? (
        <Empty>No predictions for this selection.</Empty>
      ) : (
        <div className="pb-tables">
          {byType.map(([typeId, lines]) => (
            <TypeTable key={typeId} typeId={typeId} lines={lines} pct={pctUse} showOdds={singleAgent} hitDigit={hitDigit} winner={winnerFor(typeId)} />
          ))}
        </div>
      )}
    </div>
  );
}
