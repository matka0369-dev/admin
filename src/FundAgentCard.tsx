import { useState } from 'react';
import { Alert, Button, Card, Field, api, type UserSummary } from './shared';

/**
 * Give an Agent budget. Tokens only come into existence this way: the Admin
 * grants them to an Agent, the Agent's team hands them to players, and winners
 * are paid out of the Agent's wallet — so this is the number that keeps an
 * Agent solvent. The grant is recorded in the Agent's ledger and activity log.
 */
export function FundAgentCard({ agents, onDone }: { agents: UserSummary[]; onDone: () => void }) {
  const [agentId, setAgentId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const parsed = Number(amount);
  const valid = Number.isInteger(parsed) && parsed > 0;
  const agent = agents.find((a) => a.id === agentId);

  async function give() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await api.grantTokens(agentId, parsed, note.trim() || undefined);
      setDone(`Gave ${parsed.toLocaleString()} tokens to ${agent?.username}.`);
      setAmount('');
      setNote('');
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Fund an agent" desc="Give an agent tokens to run its business: players are funded from this, and winners are paid from it.">
      {agents.length === 0 ? (
        <div className="note">No agents yet — create one first.</div>
      ) : (
        <>
          <Field label="Agent" hint={agent ? `Current wallet: ${agent.balance.toLocaleString()}` : undefined}>
            <select className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">Choose…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.username}</option>
              ))}
            </select>
          </Field>
          <Field label="Tokens">
            <input className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Note (optional)">
            <input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {error && <Alert tone="error">{error}</Alert>}
          {done && <Alert tone="success">{done}</Alert>}
          <Button variant="primary" disabled={busy || !agentId || !valid} onClick={() => void give()}>
            Give tokens
          </Button>
        </>
      )}
    </Card>
  );
}
