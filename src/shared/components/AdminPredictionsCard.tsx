import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import {
  PREDICTION_TYPE_LABEL,
  type AggregateRow,
  type GameForAdmin,
  type PredictionType,
  type UserSummary,
} from '../lib/types';
import { Alert, Card, CopyButton, Empty, Field, RefreshButton, TableWrap } from './ui';

// String order, not numeric — a picked number is a fixed-width code (a
// Jodi's "00" or a pana's "003"), not a quantity, so "10" belongs before
// "9" here rather than after it.
function byPickedNumberAscending(a: AggregateRow, b: AggregateRow): number {
  return a.pickedNumber < b.pickedNumber ? -1 : a.pickedNumber > b.pickedNumber ? 1 : 0;
}

function rowsToTsv(rows: AggregateRow[], showGame: boolean, showDate: boolean): string {
  const header = ['Number', ...(showGame ? ['Game'] : []), ...(showDate ? ['Date'] : []), 'Bets', 'Tokens'];
  const lines = [header.join('\t')];
  for (const r of [...rows].sort(byPickedNumberAscending)) {
    lines.push(
      [
        r.pickedNumber,
        ...(showGame ? [r.gameName] : []),
        ...(showDate ? [r.date] : []),
        String(r.betCount),
        String(r.totalStake),
      ].join('\t'),
    );
  }
  return lines.join('\n');
}

/**
 * The Admin's book for one game: how much is riding on each number, broken
 * out into a table per bet type.
 *
 * Deliberately not a list of individual bets — an Admin supervising a whole
 * subtree cares about exposure ("how much is on 7 today"), which a
 * per-player table answers badly. Individual bets stay with the Agent that
 * owns the Player.
 *
 * Two rules worth stating because they're easy to "fix" wrongly later:
 *
 * - The **odds column appears only when exactly one agent is in scope.**
 *   Rates are per-agent, so a number aggregated across agents has no single
 *   multiplier. The server decides this (`singleAgent`), not the client.
 * - The **percentage is a display lens only.** Entering 10 shows every
 *   amount at −10%; nothing is stored and no request re-fires. It exists to
 *   eyeball a payout after a cut without doing arithmetic by hand.
 */
export function AdminPredictionsCard({ agents }: { agents: UserSummary[] }) {
  const [games, setGames] = useState<GameForAdmin[]>([]);
  const [rows, setRows] = useState<AggregateRow[]>([]);
  const [singleAgent, setSingleAgent] = useState(false);
  const [gameId, setGameId] = useState('');
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [date, setDate] = useState('');
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

  // Games are only needed to label the dropdown, so they load once and are
  // deliberately not part of `load`'s dependency chain — refiltering rows
  // shouldn't refetch a list that can't have changed.
  useEffect(() => {
    void (async () => {
      try {
        setGames(await api.listGamesAsAdmin());
      } catch {
        // A failed game list degrades the filter to "All games" rather than
        // blocking the numbers, which are the point of this view.
      }
    })();
  }, []);

  const pct = Number(percent);
  const pctValid = percent.trim() !== '' && Number.isFinite(pct) && pct >= 0 && pct <= 100;
  const applyPct = (amount: number) => Math.round(amount * (1 - pct / 100));

  // One table per bet type, in the canonical order rather than whatever
  // order the rows happened to arrive in.
  const grouped = useMemo(() => {
    const map = new Map<PredictionType, AggregateRow[]>();
    for (const r of rows) {
      const bucket = map.get(r.typeId);
      if (bucket) bucket.push(r);
      else map.set(r.typeId, [r]);
    }
    return [...map.entries()];
  }, [rows]);

  function toggleAgent(id: string) {
    setAgentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const grandTotal = rows.reduce((sum, r) => sum + r.totalStake, 0);
  const grandBets = rows.reduce((sum, r) => sum + r.betCount, 0);

  // One line per bet type plus the whole page, for the Totals card.
  const typeTotals = grouped.map(([typeId, typeRows]) => ({
    typeId,
    numbers: typeRows.length,
    bets: typeRows.reduce((sum, r) => sum + r.betCount, 0),
    tokens: typeRows.reduce((sum, r) => sum + r.totalStake, 0),
  }));

  function totalsToTsv(): string {
    const lines = [['Type', 'Numbers', 'Bets', 'Tokens'].join('\t')];
    for (const t of typeTotals) {
      lines.push([PREDICTION_TYPE_LABEL[t.typeId], t.numbers, t.bets, t.tokens].join('\t'));
    }
    lines.push(['All types', rows.length, grandBets, grandTotal].join('\t'));
    return lines.join('\n');
  }

  return (
    <>
      <Card
        title="Predictions"
        desc="Totals per number across your subtree, broken out by bet type."
        action={<RefreshButton onClick={() => void load()} refreshing={loading} />}
      >
        {error && <Alert tone="error">{error}</Alert>}

        <div className="form-row">
          <Field label="Game">
            <select className="select" value={gameId} onChange={(e) => setGameId(e.target.value)}>
              <option value="">All games</option>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date" hint="In the game's own timezone. Blank shows every date.">
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Agents"
          hint={
            singleAgent
              ? 'One agent selected — odds shown.'
              : 'Select exactly one agent to see the rates; across agents they differ.'
          }
        >
          <div className="checkbox-list" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {agents.map((a) => (
              <label key={a.id} className="checkbox-list__item">
                <input
                  type="checkbox"
                  checked={agentIds.includes(a.id)}
                  onChange={() => toggleAgent(a.id)}
                />
                <span>{a.username}</span>
              </label>
            ))}
          </div>
          {agentIds.length === 0 && (
            <span className="field__hint">None selected — showing all your agents.</span>
          )}
        </Field>

        <Field
          label="Apply a percentage cut"
          hint={
            percent.trim() === ''
              ? 'Optional. Entering 10 shows every amount at −10%. Display only — nothing is saved.'
              : pctValid
                ? `Showing amounts at −${pct}%.`
                : 'Must be between 0 and 100.'
          }
          hintTone={percent.trim() !== '' && !pctValid ? 'bad' : undefined}
        >
          <input
            className="input"
            inputMode="numeric"
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            placeholder="10"
            aria-invalid={percent.trim() !== '' && !pctValid}
          />
        </Field>

        {!loading && rows.length > 0 && (
          <div className="note">
            {rows.length} number{rows.length === 1 ? '' : 's'} across {grouped.length} bet type
            {grouped.length === 1 ? '' : 's'} · {grandTotal.toLocaleString()} tokens total
            {pctValid && ` · ${applyPct(grandTotal).toLocaleString()} after −${pct}%`}
          </div>
        )}
      </Card>

      {loading ? (
        <Card title="Loading…">
          <Empty>Loading…</Empty>
        </Card>
      ) : rows.length === 0 ? (
        <Card title="No predictions">
          <Empty>Nothing matches that filter.</Empty>
        </Card>
      ) : (
        <>
        <Card
          title="Totals"
          desc="Every bet type, then the whole page."
          flush
          action={<CopyButton getText={totalsToTsv} />}
        >
          <TableWrap>
            <thead>
              <tr>
                <th>Type</th>
                <th style={{ textAlign: 'right' }}>Numbers</th>
                <th style={{ textAlign: 'right' }}>Bets</th>
                <th style={{ textAlign: 'right' }}>Tokens</th>
                {pctValid && <th style={{ textAlign: 'right' }}>−{pct}%</th>}
              </tr>
            </thead>
            <tbody>
              {typeTotals.map((t) => (
                <tr key={t.typeId}>
                  <td className="cell-strong">{PREDICTION_TYPE_LABEL[t.typeId]}</td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{t.numbers}</td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{t.bets.toLocaleString()}</td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{t.tokens.toLocaleString()}</td>
                  {pctValid && (
                    <td className="cell-num" style={{ textAlign: 'right' }}>{applyPct(t.tokens).toLocaleString()}</td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td>All types</td>
                <td className="cell-num" style={{ textAlign: 'right' }}>{rows.length}</td>
                <td className="cell-num" style={{ textAlign: 'right' }}>{grandBets.toLocaleString()}</td>
                <td className="cell-num" style={{ textAlign: 'right' }}>{grandTotal.toLocaleString()}</td>
                {pctValid && (
                  <td className="cell-num" style={{ textAlign: 'right' }}>{applyPct(grandTotal).toLocaleString()}</td>
                )}
              </tr>
            </tfoot>
          </TableWrap>
        </Card>
        {grouped.map(([typeId, typeRows]) => {
          const typeTotal = typeRows.reduce((sum, r) => sum + r.totalStake, 0);
          const typeBets = typeRows.reduce((sum, r) => sum + r.betCount, 0);
          return (
            <Card
              key={typeId}
              title={PREDICTION_TYPE_LABEL[typeId]}
              desc={`${typeRows.length} number${typeRows.length === 1 ? '' : 's'} · ${typeTotal.toLocaleString()} tokens${
                pctValid ? ` · ${applyPct(typeTotal).toLocaleString()} after −${pct}%` : ''
              }`}
              flush
              action={<CopyButton getText={() => rowsToTsv(typeRows, !gameId, !date)} />}
            >
              <TableWrap>
                <thead>
                  <tr>
                    <th>Number</th>
                    {!gameId && <th>Game</th>}
                    {!date && <th>Date</th>}
                    <th style={{ textAlign: 'right' }}>Bets</th>
                    <th style={{ textAlign: 'right' }}>Tokens</th>
                    {pctValid && <th style={{ textAlign: 'right' }}>−{pct}%</th>}
                    {singleAgent && <th style={{ textAlign: 'right' }}>Odds</th>}
                  </tr>
                </thead>
                <tbody>
                  {typeRows.map((r) => (
                    <tr key={`${r.gameId}-${r.date}-${r.pickedNumber}`}>
                      <td className="cell-strong cell-num">{r.pickedNumber}</td>
                      {!gameId && <td>{r.gameName}</td>}
                      {!date && <td className="cell-muted">{r.date}</td>}
                      <td className="cell-num" style={{ textAlign: 'right' }}>
                        {r.betCount}
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>
                        {r.totalStake.toLocaleString()}
                      </td>
                      {pctValid && (
                        <td className="cell-num" style={{ textAlign: 'right' }}>
                          {applyPct(r.totalStake).toLocaleString()}
                        </td>
                      )}
                      {singleAgent && (
                        <td className="cell-num" style={{ textAlign: 'right' }}>
                          {r.odds === null ? '—' : `${r.odds}x`}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700 }}>
                    <td>Total</td>
                    {!gameId && <td />}
                    {!date && <td />}
                    <td className="cell-num" style={{ textAlign: 'right' }}>{typeBets.toLocaleString()}</td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{typeTotal.toLocaleString()}</td>
                    {pctValid && (
                      <td className="cell-num" style={{ textAlign: 'right' }}>{applyPct(typeTotal).toLocaleString()}</td>
                    )}
                    {singleAgent && <td />}
                  </tr>
                </tfoot>
              </TableWrap>
            </Card>
          );
        })}
        </>
      )}
    </>
  );
}
