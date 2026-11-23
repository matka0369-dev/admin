import { useEffect, useMemo } from 'react';
import { Alert, Button, Card, CopyButton, Empty, Field, RefreshButton, type UserSummary } from './shared';
import {
  CATEGORIES, CATEGORY_LABEL, buildBills, billText, calculate, dueLabel, fmtAmount, type AgentBill, type Category,
} from './bill';
import {
  addAdjustment, dayString, ensureData, refresh, removeAdjustment, setCarry, setFilters, updateAdjustment, usePageSettlements,
} from './settlementsStore';
import './settlementBill.css';
import './adminControls.css';

/**
 * One bill per agent for a day, laid out like the dashboard's settlement tab
 * with agents standing in for groups: a line per game with the winnings split
 * by type, then the calculation (bet, commission, remaining, winning, due or
 * payment), adjustments, any balance carried over, and the final figure.
 *
 * Amounts are the Admin-to-Agent position at the rate between you two, not
 * wallet movements. Commission, adjustments and the carried balance are
 * working figures for the bill: they are not stored.
 */
export function SettlementBill({ agents }: { agents: UserSummary[] }) {
  const { filters, rows, shownDate, loading, error, fetchedAt } = usePageSettlements();
  const { date, agentId, commission } = filters;

  useEffect(() => {
    void ensureData(); // from cache when it is still fresh
  }, []);

  const bills = useMemo(() => buildBills(rows), [rows]);
  const day = date || shownDate || '';
  const updated = fetchedAt
    ? new Date(fetchedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
    : null;

  return (
    <>
      <Card
        title="Settlement bills"
        desc="Your position against each agent for a day, game by game. Due = the agent owes you."
        action={<RefreshButton onClick={() => refresh()} refreshing={loading} />}
      >
        <div className="filter-row">
          <Field label="Date">
            <input className="input" type="date" value={day} onChange={(e) => setFilters({ date: e.target.value })} />
          </Field>
          <Button onClick={() => setFilters({ date: '' })}>Latest</Button>
          <Button onClick={() => setFilters({ date: dayString(0) })}>Today</Button>
          <Button onClick={() => setFilters({ date: dayString(-1) })}>Yesterday</Button>
          <Field label="Agent">
            <select className="select" value={agentId} onChange={(e) => setFilters({ agentId: e.target.value })}>
              <option value="">All agents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.username}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Commission (%)">
            <input
              className="input"
              style={{ width: 110 }}
              inputMode="decimal"
              value={commission}
              placeholder="0"
              title="Taken off the day's bet before the winnings. A working figure, not stored."
              onChange={(e) => setFilters({ commission: e.target.value })}
            />
          </Field>
        </div>
        <div className="note" style={{ marginTop: 10 }}>
          {date === '' && shownDate ? `Latest settled day: ${shownDate}. ` : ''}
          {updated ? `Updated ${updated}.` : ''}
        </div>
      </Card>

      {error && <Alert tone="error">{error}</Alert>}
      {loading && rows.length === 0 ? (
        <Card><Empty>Loading…</Empty></Card>
      ) : bills.length === 0 ? (
        <Card>
          <Empty>Nothing settled{date ? ' on that day' : ' yet'}. A bill appears once the Platform Admin enters a result for a game your agents' players bet on.</Empty>
        </Card>
      ) : (
        bills.map((b) => <BillCard key={b.agentId} bill={b} day={day} commission={commission} />)
      )}
    </>
  );
}

function BillCard({ bill, day, commission }: { bill: AgentBill; day: string; commission: string }) {
  const { adjustments, carry } = usePageSettlements();
  const adj = adjustments[bill.agentId] ?? [];
  const cy = carry[bill.agentId];
  const calc = calculate(bill, commission, adj, cy);
  const usedCats = CATEGORIES.filter((c) => c !== 'sangam' || bill.games.some((g) => g.byCategory.sangam > 0));
  const tone = (n: number) => (n < 0 ? 'is-negative' : n > 0 ? 'is-positive' : '');

  return (
    <Card
      title={bill.agent}
      desc={`${day} · ${bill.games.length} game${bill.games.length === 1 ? '' : 's'}`}
      action={<CopyButton getText={() => billText(bill, day, calc, cy)} />}
      flush
    >
      <div className="sb-scroll">
        <table className="sb-table">
          <thead>
            <tr>
              <th>Game</th>
              <th className="sb-num">Bet</th>
              {usedCats.map((c: Category) => (
                <th key={c} className="sb-num">{CATEGORY_LABEL[c]}</th>
              ))}
              <th className="sb-num">Win</th>
            </tr>
          </thead>
          <tbody>
            {bill.games.map((g) => (
              <tr key={g.key}>
                <td className="sb-strong">{g.game}</td>
                <td className="sb-num">{fmtAmount(g.bet)}</td>
                {usedCats.map((c) => (
                  <td key={c} className="sb-num sb-muted">{g.byCategory[c] ? fmtAmount(g.byCategory[c]) : '—'}</td>
                ))}
                <td className="sb-num">{fmtAmount(g.win)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="sb-num">{fmtAmount(bill.totalBet)}</td>
              {usedCats.map((c) => (
                <td key={c} />
              ))}
              <td className="sb-num">{fmtAmount(bill.totalWin)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="sb-calc">
        <Row label="Total bet amount" value={fmtAmount(bill.totalBet)} />
        {calc.commissionPct > 0 && (
          <>
            <Row label={`Commission (${calc.commissionPct}%)`} value={fmtAmount(calc.commission)} />
            <Row label="Remaining" value={fmtAmount(calc.remaining)} />
          </>
        )}
        <Row label="Total winning" value={fmtAmount(bill.totalWin)} />
        <Row label={dueLabel(calc.day)} value={fmtAmount(calc.day)} cls={`sb-result ${tone(calc.day)}`} />

        {adj.map((a, i) => (
          <div className="sb-adj" key={a.id}>
            <input
              className="input"
              placeholder="Adjustment"
              value={a.title}
              onChange={(e) => updateAdjustment(bill.agentId, a.id, { title: e.target.value })}
            />
            <select
              className="select"
              value={a.sign}
              onChange={(e) => updateAdjustment(bill.agentId, a.id, { sign: Number(e.target.value) as 1 | -1 })}
              aria-label="Add or subtract"
            >
              <option value={1}>+</option>
              <option value={-1}>−</option>
            </select>
            <input
              className="input sb-amt"
              inputMode="decimal"
              placeholder="0"
              value={a.amount}
              onChange={(e) => updateAdjustment(bill.agentId, a.id, { amount: e.target.value })}
            />
            <span className="sb-running">{fmtAmount(calc.chain[i].running)}</span>
            <Button size="sm" onClick={() => removeAdjustment(bill.agentId, a.id)} aria-label="Remove adjustment">✕</Button>
          </div>
        ))}
        <div className="sb-actions">
          <Button size="sm" onClick={() => addAdjustment(bill.agentId)}>+ Adjustment</Button>
        </div>

        <div className="sb-adj">
          <span className="sb-label">Balance carried over</span>
          <select
            className="select"
            value={cy?.type ?? 'due'}
            onChange={(e) => setCarry(bill.agentId, { type: e.target.value as 'due' | 'payment' })}
            aria-label="Old balance type"
          >
            <option value="due">Old due</option>
            <option value="payment">Old payment</option>
          </select>
          <input
            className="input sb-amt"
            inputMode="decimal"
            placeholder="0"
            value={cy?.amount ?? ''}
            onChange={(e) => setCarry(bill.agentId, { amount: e.target.value })}
          />
        </div>

        <Row
          label={`Final ${dueLabel(calc.final).toLowerCase()}`}
          value={fmtAmount(calc.final)}
          cls={`sb-result sb-final ${tone(calc.final)}`}
        />
      </div>
    </Card>
  );
}

function Row({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className={`sb-row ${cls ?? ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
