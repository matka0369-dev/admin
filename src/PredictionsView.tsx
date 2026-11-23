import { useState } from 'react';
import { AdminPredictionsCard, type UserSummary } from './shared';
import { PredictionsBoard } from './PredictionsBoard';

type View = 'board' | 'classic';
const KEY = 'predictsim.predictionsView';

function initialView(): View {
  try {
    return localStorage.getItem(KEY) === 'classic' ? 'classic' : 'board';
  } catch {
    return 'board'; // storage can be blocked; the page works without it
  }
}

/**
 * Both predictions views, one switch. "Board" is the dashboard-style layout;
 * "Classic" is the original card, unchanged. The choice is remembered per
 * browser as a convenience only.
 */
export function PredictionsView({ agents }: { agents: UserSummary[] }) {
  const [view, setView] = useState<View>(initialView);

  function pick(v: View) {
    setView(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <div className="pv-switch" role="group" aria-label="Predictions view">
        <button type="button" aria-pressed={view === 'board'} onClick={() => pick('board')}>
          Board
        </button>
        <button type="button" aria-pressed={view === 'classic'} onClick={() => pick('classic')}>
          Classic
        </button>
      </div>
      {view === 'board' ? <PredictionsBoard agents={agents} /> : <AdminPredictionsCard agents={agents} />}
    </>
  );
}
