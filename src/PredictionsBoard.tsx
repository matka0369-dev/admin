import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  CopyButton,
  Empty,
  PREDICTION_TYPE_LABEL,
  RefreshButton,
  api,
  ApiError,
  type AggregateRow,
  type GameForAdmin,
  type PredictionType,
  type UserSummary,
} from './shared';
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
 * with Today / Yesterday buttons); clearing the date adds every day together,
 * so a number appears once with its combined amount.
 */

const TZ = 'Asia/Kolkata';
const dayString = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
};

interface Line {
  number: string;
  bets: number;
  amount: number; // before the percentage cut
  odds: number | null;
}

type SortKey = 'number' | 'amount';

const fmt = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n);

// First digit of a Jodi ("05" -> 0, "47" -> 4).
const jodiDigit = (n: string) => Math.min(9, Math.max(0, Math.floor((parseInt(n, 10) || 0) / 10)));

function TypeTable({
  typeId,
  lines,
  pct,
  showOdds,
}: {
  typeId: PredictionType;
  lines: Line[];
  pct: number;
  showOdds: boolean;
}) {
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
  // Jodi rows are grouped by first digit with a subtotal, as the mdash page
  // does — only while sorted by number, since a group means nothing otherwise.
  const grouped = isJodi && sortKey === 'number' && asc;

  const copyAll = () => sorted.map((l) => `${l.number}: ${l.amount}`).join('\n');
  const copyJodiGroup = (digit: number) => {
    const amounts = new Map(shown.map((l) => [l.number.padStart(2, '0'), l.amount]));
    return Array.from({ length: 10 }, (_, i) => {
      const key = `${digit}${i}`;
      return `${key}: ${amounts.get(key) ?? 0}`;
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
        <CopyButton getText={copyAll} />
      </header>
      <div className="pb-table__scroll">
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
                <tr key={`g${r.digit}`} className="pb-group">
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
                <tr key={r.line.number}>
                  <td className="pb-strong">{r.line.number}</td>
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
  const [games, setGames] = useState<GameForAdmin[]>([]);
  const [rows, setRows] = useState<AggregateRow[]>([]);
  const [singleAgent, setSingleAgent] = useState(false);
  const [gameId, setGameId] = useState('');
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [date, setDate] = useState(dayString(0));
  const [percent, setPercent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.aggregatePredictions({
        ...(gameId ? { gameId } : {}),
        ...(date ? { date } : {}),
        ...(agentIds.length ? { agentIds } : {}),
      });
      setRows(res.rows);
      setSingleAgent(res.singleAgent);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [gameId, date, agentIds]);

  useEffect(() => {
    void load();
  }, [load]);

  // Only labels the dropdown, so it loads once and stays out of `load`.
  useEffect(() => {
    void (async () => {
      try {
        setGames(await api.listGamesAsAdmin());
      } catch {
        // A failed game list degrades the filter to "All games".
      }
    })();
  }, []);

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

  const toggleAgent = (id: string) =>
    setAgentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="pb">
      <div className="pb-controls">
        <div className="pb-card">
          <p className="pb-card__title">Totals</p>
          <div className="pb-metric">{fmt(grandRaw)}</div>
          <div className="pb-sub">
            {grandBets.toLocaleString()} bets · {byType.length} bet type{byType.length === 1 ? '' : 's'}
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
            <Button size="sm" onClick={() => setDate('')}>
              All days
            </Button>
          </div>
          <div className="pb-sub">{date ? `Showing ${date}.` : 'Every day added together.'}</div>
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
            <TypeTable key={typeId} typeId={typeId} lines={lines} pct={pctUse} showOdds={singleAgent} />
          ))}
        </div>
      )}
    </div>
  );
}
