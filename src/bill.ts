import type { PredictionType, SettlementRow } from './shared';

// The arithmetic behind the settlement bill, kept free of React so it can be
// tested. The layout follows the dashboard's settlement tab (one bill per
// group, with agents standing in for groups): a row per game, then
//   total bet - commission = remaining;  remaining - total winning = due/payment
// then the day's adjustments and any balance carried over from before.

/** The winning columns of the bill, as on the dashboard. */
export type Category = 'open' | 'jodi' | 'openPana' | 'close' | 'closePana' | 'sangam';

export const CATEGORY_LABEL: Record<Category, string> = {
  open: 'Open',
  jodi: 'Jodi',
  openPana: 'Open pana',
  close: 'Close',
  closePana: 'Close pana',
  sangam: 'Sangam',
};
export const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];

export function categoryOf(t: PredictionType): Category {
  switch (t) {
    case 'OPEN_SINGLE':
      return 'open';
    case 'CLOSE_SINGLE':
      return 'close';
    case 'JODI':
      return 'jodi';
    case 'OPEN_SINGLE_PANA':
    case 'OPEN_DOUBLE_PANA':
    case 'OPEN_TRIPLE_PANA':
      return 'openPana';
    case 'CLOSE_SINGLE_PANA':
    case 'CLOSE_DOUBLE_PANA':
    case 'CLOSE_TRIPLE_PANA':
      return 'closePana';
    default:
      return 'sangam'; // HALF_SANGAM, FULL_SANGAM
  }
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface GameLine {
  key: string;
  game: string;
  bet: number;
  win: number;
  byCategory: Record<Category, number>;
}

export interface AgentBill {
  agentId: string;
  agent: string;
  games: GameLine[];
  totalBet: number;
  totalWin: number;
}

const emptyCats = (): Record<Category, number> => ({ open: 0, jodi: 0, openPana: 0, close: 0, closePana: 0, sangam: 0 });

/** One bill per agent: a line per game, winnings split by type. */
export function buildBills(rows: SettlementRow[]): AgentBill[] {
  const byAgent = new Map<string, AgentBill>();
  for (const r of rows) {
    let bill = byAgent.get(r.agentId);
    if (!bill) byAgent.set(r.agentId, (bill = { agentId: r.agentId, agent: r.agentUsername, games: [], totalBet: 0, totalWin: 0 }));
    const cats = emptyCats();
    for (const l of r.lines) cats[categoryOf(l.typeId)] += l.payout;
    bill.games.push({ key: r.id, game: r.gameName, bet: r.totalStaked, win: r.totalPayout, byCategory: cats });
    bill.totalBet += r.totalStaked;
    bill.totalWin += r.totalPayout;
  }
  return [...byAgent.values()].sort((a, b) => a.agent.localeCompare(b.agent));
}

export interface AdjustmentIn {
  title: string;
  sign: 1 | -1;
  amount: string;
}

export interface Calc {
  commissionPct: number;
  commission: number;
  remaining: number;
  /** remaining - winning. Positive: the agent owes you. Negative: you owe the agent. */
  day: number;
  /** The day figure after each adjustment, in order. */
  chain: { title: string; running: number }[];
  carryDelta: number;
  final: number;
}

const num = (s: string | number) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

export function calculate(
  bill: Pick<AgentBill, 'totalBet' | 'totalWin'>,
  commissionText: string,
  adjustments: AdjustmentIn[],
  carry: { type: 'due' | 'payment'; amount: string } | undefined,
): Calc {
  const commissionPct = Math.min(Math.max(num(commissionText), 0), 100);
  const commission = round2((bill.totalBet * commissionPct) / 100);
  const remaining = round2(bill.totalBet - commission);
  const day = round2(remaining - bill.totalWin);

  let running = day;
  const chain = adjustments.map((a) => {
    running = round2(running + a.sign * num(a.amount));
    return { title: a.title.trim() || 'Adjustment', running };
  });

  const carryAmount = Math.abs(num(carry?.amount ?? ''));
  const carryDelta = carry && carryAmount > 0 ? (carry.type === 'due' ? carryAmount : -carryAmount) : 0;
  return { commissionPct, commission, remaining, day, chain, carryDelta, final: round2(running + carryDelta) };
}

/** "Due" when the agent owes you, "payment" when you owe the agent. */
export const dueLabel = (n: number) => (n < 0 ? 'Payment' : 'Due');

export const fmtAmount = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, useGrouping: false }).format(n);

/** The bill as plain text, ready to paste into a chat. */
export function billText(bill: AgentBill, date: string, calc: Calc, carry: { type: 'due' | 'payment'; amount: string } | undefined): string {
  const lines: string[] = [`${bill.agent} - ${date}`, ''];
  for (const g of bill.games) lines.push(`${g.game}: bet ${fmtAmount(g.bet)}, win ${fmtAmount(g.win)}`);
  lines.push('', `Total bet: ${fmtAmount(bill.totalBet)}`);
  if (calc.commissionPct > 0) lines.push(`Commission (${calc.commissionPct}%): ${fmtAmount(calc.commission)}`, `Remaining: ${fmtAmount(calc.remaining)}`);
  lines.push(`Total winning: ${fmtAmount(bill.totalWin)}`, `${dueLabel(calc.day)}: ${fmtAmount(calc.day)}`);
  for (const c of calc.chain) lines.push(`${c.title}: ${fmtAmount(c.running)}`);
  if (carry && calc.carryDelta !== 0) lines.push(`Old ${carry.type}: ${fmtAmount(calc.carryDelta)}`);
  lines.push(`Final ${dueLabel(calc.final).toLowerCase()}: ${fmtAmount(calc.final)}`);
  return lines.join('\n');
}
