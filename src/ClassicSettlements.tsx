import { useEffect } from 'react';
import { Alert, Card, Empty, Field, PREDICTION_TYPE_LABEL, RefreshButton, TableWrap } from './shared';
import { ensureData, refresh, setFilters, usePageSettlements } from './settlementsStore';

function Signed({ value }: { value: number }) {
  return (
    <span
      className="cell-num"
      style={{ color: value < 0 ? 'var(--danger)' : value > 0 ? 'var(--success)' : undefined }}
    >
      {value > 0 ? '+' : ''}
      {value.toLocaleString()}
    </span>
  );
}

/**
 * The original Settlements card, kept as the "Classic" view next to the Bill.
 * Unchanged apart from where its data comes from.
 *
 * The Admin↔Agent position, per game per day.
 *
 * The **same stored row** serves both tiers — the two sides operate at one
 * rate against each other, so the Agent's position is the exact negation of
 * the Admin's. The server does the flip and tells us which side we're on
 * (`viewerIsAgent`), so this component never has to work out whose numbers
 * it's holding; it only picks the wording.
 *
 * Amounts here are **not** wallet movements. Player stakes and payouts move
 * real balances; this is the accounting between the two tiers above them.
 */
export function ClassicSettlements() {
  // Filters and data come from the shared store (see settlementsStore.ts), so
  // this view and the Bill show the same day and switching costs no request.
  const { filters, rows, shownDate, error, loading } = usePageSettlements();
  const date = filters.date;
  const setDate = (v: string) => setFilters({ date: v });
  const load = refresh;

  useEffect(() => {
    void ensureData(); // from cache when it is still fresh
  }, []);

  const data = { viewerIsAgent: false, date: shownDate };
  const isAgent = data.viewerIsAgent;
  const dayNet = rows.reduce((sum, r) => sum + r.net, 0);

  return (
    <>
      <Card
        title="Settlements"
        desc={
          isAgent
            ? 'Your position against your Admin, per game. Positive means owed to you.'
            : 'Your position against each agent, per game. Positive means owed to you.'
        }
        action={<RefreshButton onClick={() => void load()} refreshing={loading} />}
      >
        {error && <Alert tone="error">{error}</Alert>}

        <Field
          label="Date"
          hint={
            date
              ? undefined
              : data?.date
                ? `Showing the latest settled day (${data.date}).`
                : 'Nothing settled yet.'
          }
        >
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>

        {rows.length > 0 && (
          <div className="note">
            Day total: <Signed value={dayNet} /> across {rows.length} game
            {rows.length === 1 ? '' : 's'}
          </div>
        )}
      </Card>

      {loading ? (
        <Card title="Loading…">
          <Empty>Loading…</Empty>
        </Card>
      ) : rows.length === 0 ? (
        <Card title="No settlements">
          <Empty>
            Nothing settled{date ? ' on that date' : ' yet'} — a settlement appears once Platform
            Admin enters a result for a game your players bet on.
          </Empty>
        </Card>
      ) : (
        rows.map((r) => (
          <Card
            key={r.id}
            title={`${r.gameName} — ${r.date}`}
            desc={
              [
                isAgent ? `vs ${r.adminUsername}` : `vs ${r.agentUsername}`,
                r.openPana ? `open ${r.openPana}` : null,
                r.closePana ? `close ${r.closePana}` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            }
            flush
          >
            <div style={{ padding: '0 16px 12px' }}>
              <div className="grid grid--stats">
                <div className="card stat">
                  <div className="stat__label">Total played</div>
                  <div className="stat__value">
                    <Signed value={r.totalStaked} />
                  </div>
                  <div className="stat__hint">Every token staked on this game</div>
                </div>
                <div className="card stat">
                  <div className="stat__label">Winnings owed</div>
                  <div className="stat__value">
                    <Signed value={r.totalPayout} />
                  </div>
                  <div className="stat__hint">At the rate between you two</div>
                </div>
                <div className="card stat">
                  <div className="stat__label">Net</div>
                  <div className="stat__value">
                    <Signed value={r.net} />
                  </div>
                  <div className="stat__hint">{r.net < 0 ? 'You owe' : 'Owed to you'}</div>
                </div>
                {((r as { agentShare?: number }).agentShare ?? 0) > 0 && (
                  <div className="card stat">
                    <div className="stat__label">Your share ({10 - ((r as { agentShare?: number }).agentShare ?? 0)}/10)</div>
                    <div className="stat__value">
                      <Signed value={(r as { yourResult?: number }).yourResult ?? 0} />
                    </div>
                    <div className="stat__hint">What changes hands; the agent bears the rest</div>
                  </div>
                )}
              </div>
            </div>

            {r.lines.length === 0 ? (
              <Empty>No winning numbers — the whole day's stake stands.</Empty>
            ) : (
              <TableWrap>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Winning number</th>
                    <th style={{ textAlign: 'right' }}>Staked on it</th>
                    <th style={{ textAlign: 'right' }}>Rate</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {r.lines.map((l) => (
                    <tr key={`${l.typeId}-${l.pickedNumber}`}>
                      <td>{PREDICTION_TYPE_LABEL[l.typeId]}</td>
                      <td className="cell-strong cell-num">{l.pickedNumber}</td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>
                        {l.stake.toLocaleString()}
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>
                        {l.agentOdds}x
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <Signed value={l.payout} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Card>
        ))
      )}
    </>
  );
}
