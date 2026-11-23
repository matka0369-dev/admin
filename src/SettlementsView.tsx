import { type UserSummary } from './shared';
import { ClassicSettlements } from './ClassicSettlements';
import { SettlementBill } from './SettlementBill';
import { getDefaultView, setDefaultView, setView, usePageSettlements } from './settlementsStore';

/**
 * Both settlement views behind one switch, over one shared store. Same
 * behaviour as the Predictions page: the view you are on is kept when you
 * change tab, and "Use as my default" saves it for this browser.
 */
export function SettlementsView({ agents }: { agents: UserSummary[] }) {
  const { view } = usePageSettlements();
  const isDefault = getDefaultView() === view;
  const name = (v: string) => (v === 'bill' ? 'Bill' : 'Classic');

  return (
    <>
      <div className="pv-bar">
        <div className="pv-switch" role="group" aria-label="Settlements view">
          <button type="button" aria-pressed={view === 'bill'} onClick={() => setView('bill')}>
            Bill
          </button>
          <button type="button" aria-pressed={view === 'classic'} onClick={() => setView('classic')}>
            Classic
          </button>
        </div>
        <label className="pv-default">
          <input type="checkbox" checked={isDefault} disabled={isDefault} onChange={() => setDefaultView(view)} />
          <span>{isDefault ? `${name(view)} is your default` : 'Use as my default'}</span>
        </label>
      </div>
      {view === 'bill' ? <SettlementBill agents={agents} /> : <ClassicSettlements />}
    </>
  );
}
