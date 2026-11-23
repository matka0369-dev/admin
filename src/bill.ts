import type { PredictionType, SettlementRow } from './shared';

/** A settlement row as the server now sends it: the share fields are new, so a
 *  server that has not been updated yet simply leaves them out (read as no split). */
export type SettlementRowX = SettlementRow & { agentShare?: number; transfer?: number; yourResult?: number };

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
  /** The Agent's slice of profit and loss, in tenths (0 = the Admin carries it all). */
  agentShare: number;
}

const emptyCats = (): Record<Category, number> => ({ open: 0, jodi: 0, openPana: 0, close: 0, closePana: 0, sangam: 0 });

/** One bill per agent: a line per game, winnings split by type. */
export function buildBills(rows: SettlementRowX[]): AgentBill[] {
  const byAgent = new Map<string, AgentBill>();
  for (const r of rows) {
    let bill = byAgent.get(r.agentId);
    if (!bill) byAgent.set(r.agentId, (bill = { agentId: r.agentId, agent: r.agentUsername, games: [], totalBet: 0, totalWin: 0, agentShare: r.agentShare ?? 0 }));
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
  /** The cut taken off the bet, in percent. From the agent's share when it has one
   *  (share 2 = a 20% cut); otherwise the manual commission lens. */
  commissionPct: number;
  commission: number;
  remaining: number;
  /** What you pay on the winners: the remaining bet at the rate you give this agent. */
  winningOnRemaining: number;
  /** The whole day: remaining - winning. A loss (players won) is negative. */
  day: number;
  /** The Agent's slice of `day`, in tenths of it. A loss is a loss for both tiers. */
  agentSlice: number;
  /** Your slice of `day`, and what actually changes hands: positive, the agent
   *  owes you; negative, you owe the agent. */
  adminSlice: number;
  /** The figure after each adjustment, in order, starting from `adminSlice`. */
  chain: { title: string; running: number }[];
  carryDelta: number;
  final: number;
}

/** Splits a day between the tiers by the Agent's share (tenths): half away from
 *  zero, with the Agent's slice as the remainder so the two always add up. Same
 *  rule as the server's, for the commission lens that is applied on screen. */
export function splitByShare(net: number, agentShare: number): { adminSlice: number; agentSlice: number } {
  const s = Math.min(Math.max(Math.trunc(agentShare) || 0, 0), 10);
  const raw = (net * (10 - s)) / 10;
  const adminSlice = Math.sign(raw) * Math.round(Math.abs(raw)); // whole tokens, as on the server
  return { adminSlice, agentSlice: round2(net - adminSlice) };
}

const num = (s: string | number) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

export function calculate(
  bill: Pick<AgentBill, 'totalBet' | 'totalWin'> & { agentShare?: number },
  commissionText: string,
  adjustments: AdjustmentIn[],
  carry: { type: 'due' | 'payment'; amount: string } | undefined,
): Calc {
  const share = bill.agentShare ?? 0;
  // With a share, the cut is the agent's: it comes off the stake you settle on,
  // and your winners are paid on what is left (20% cut: a 100 bet that wins costs
  // you 80 x your rate, while the agent pays its player 100 x the giving rate).
  // Without one, the manual commission lens stays as a working figure.
  const commissionPct = share > 0 ? share * 10 : Math.min(Math.max(num(commissionText), 0), 100);
  const commission = round2((bill.totalBet * commissionPct) / 100);
  const remaining = round2(bill.totalBet - commission);
  let day: number;
  let adminSlice: number;
  let agentSlice: number;
  let winningOnRemaining: number;
  if (share > 0) {
    // The whole position, split exactly as the server does: your slice is what changes hands.
    const whole = round2(bill.totalBet - bill.totalWin);
    ({ adminSlice, agentSlice } = splitByShare(whole, share));
    day = whole;
    winningOnRemaining = round2(remaining - adminSlice); // so the lines on screen add up
  } else {
    winningOnRemaining = bill.totalWin;
    day = round2(remaining - bill.totalWin);
    adminSlice = day;
    agentSlice = 0;
  }

  let running = adminSlice;
  const chain = adjustments.map((a) => {
    running = round2(running + a.sign * num(a.amount));
    return { title: a.title.trim() || 'Adjustment', running };
  });

  const carryAmount = Math.abs(num(carry?.amount ?? ''));
  const carryDelta = carry && carryAmount > 0 ? (carry.type === 'due' ? carryAmount : -carryAmount) : 0;
  return { commissionPct, commission, remaining, winningOnRemaining, day, agentSlice, adminSlice, chain, carryDelta, final: round2(running + carryDelta) };
}

/** "Due" when the agent owes you, "payment" when you owe the agent. */
export const dueLabel = (n: number) => (n < 0 ? 'Payment' : 'Due');

export const fmtAmount = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, useGrouping: false }).format(n);

/** The bill as plain text, ready to paste into a chat. */
export function billText(bill: AgentBill, date: string, calc: Calc, carry: { type: 'due' | 'payment'; amount: string } | undefined): string {
  const lines: string[] = [`${bill.agent} - ${date}`, ''];
  for (const g of bill.games) lines.push(`${g.game}: bet ${fmtAmount(g.bet)}, win ${fmtAmount(g.win)}`);
  lines.push('', `Total bet: ${fmtAmount(bill.totalBet)}`);
  if (calc.commissionPct > 0) {
    lines.push(
      `${bill.agentShare > 0 ? 'Agent cut' : 'Commission'} (${calc.commissionPct}%): ${fmtAmount(calc.commission)}`,
      `Remaining: ${fmtAmount(calc.remaining)}`,
    );
  }
  lines.push(`Total winning: ${fmtAmount(bill.agentShare > 0 ? calc.winningOnRemaining : bill.totalWin)}`);
  lines.push(`${dueLabel(calc.adminSlice)}: ${fmtAmount(calc.adminSlice)}`);
  if (bill.agentShare > 0) lines.push(`Agent bears: ${fmtAmount(calc.agentSlice)}`);
  for (const c of calc.chain) lines.push(`${c.title}: ${fmtAmount(c.running)}`);
  if (carry && calc.carryDelta !== 0) lines.push(`Old ${carry.type}: ${fmtAmount(calc.carryDelta)}`);
  lines.push(`Final ${dueLabel(calc.final).toLowerCase()}: ${fmtAmount(calc.final)}`);
  return lines.join('\n');
}
