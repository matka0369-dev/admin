import { describe, expect, it } from 'vitest';
import { billText, buildBills, calculate, categoryOf, dueLabel, splitByShare } from '../bill';
import type { SettlementRow } from '../shared';

const row = (over: Partial<SettlementRow>): SettlementRow => ({
  id: 'r1', date: '2026-11-23', gameId: 'g1', gameName: 'Sridevi', agentId: 'a1', agentUsername: 'agent_one',
  adminId: 'm1', adminUsername: 'admin', openPana: '128', closePana: '678',
  totalStaked: 1000, totalPayout: 300, net: 700, lines: [], ...over,
});

describe('categories', () => {
  it('groups the bet types the way the dashboard bill does', () => {
    expect(categoryOf('OPEN_SINGLE')).toBe('open');
    expect(categoryOf('CLOSE_SINGLE')).toBe('close');
    expect(categoryOf('JODI')).toBe('jodi');
    expect(categoryOf('OPEN_DOUBLE_PANA')).toBe('openPana');
    expect(categoryOf('CLOSE_TRIPLE_PANA')).toBe('closePana');
    expect(categoryOf('FULL_SANGAM')).toBe('sangam');
  });
});

describe('buildBills', () => {
  it('makes one bill per agent, a line per game, with winnings split by type', () => {
    const rows = [
      row({ id: 'r1', totalStaked: 1000, totalPayout: 900, lines: [
        { typeId: 'OPEN_SINGLE', pickedNumber: '1', stake: 100, agentOdds: 9, payout: 900 },
      ] }),
      row({ id: 'r2', gameName: 'Kuber', totalStaked: 500, totalPayout: 4200, lines: [
        { typeId: 'CLOSE_SINGLE_PANA', pickedNumber: '128', stake: 30, agentOdds: 140, payout: 4200 },
      ] }),
      row({ id: 'r3', agentId: 'a2', agentUsername: 'agent_two', totalStaked: 70, totalPayout: 0 }),
    ];
    const bills = buildBills(rows);
    expect(bills.map((b) => b.agent)).toEqual(['agent_one', 'agent_two']);
    const one = bills[0];
    expect(one.games.map((g) => g.game)).toEqual(['Sridevi', 'Kuber']);
    expect(one.totalBet).toBe(1500);
    expect(one.totalWin).toBe(5100);
    expect(one.games[0].byCategory.open).toBe(900);
    expect(one.games[1].byCategory.closePana).toBe(4200);
  });
});

describe('calculate', () => {
  const bill = { totalBet: 1000, totalWin: 300 };

  it('is bet minus winning when there is no commission', () => {
    const c = calculate(bill, '', [], undefined);
    expect(c.commission).toBe(0);
    expect(c.day).toBe(700);
    expect(c.final).toBe(700);
    expect(dueLabel(c.day)).toBe('Due');
  });

  it('takes commission off the bet before the winnings', () => {
    const c = calculate(bill, '10', [], undefined);
    expect(c.commission).toBe(100);
    expect(c.remaining).toBe(900);
    expect(c.day).toBe(600); // 900 - 300
  });

  it('turns into a payment when the winnings are bigger', () => {
    const c = calculate({ totalBet: 500, totalWin: 4200 }, '', [], undefined);
    expect(c.day).toBe(-3700);
    expect(dueLabel(c.day)).toBe('Payment');
  });

  it('chains adjustments in order and adds a carried balance', () => {
    const c = calculate(bill, '', [
      { title: 'Cash received', sign: -1, amount: '200' },
      { title: '', sign: 1, amount: '50' },
    ], { type: 'payment', amount: '100' });
    expect(c.chain).toEqual([{ title: 'Cash received', running: 500 }, { title: 'Adjustment', running: 550 }]);
    expect(c.carryDelta).toBe(-100);
    expect(c.final).toBe(450);
  });

  it('ignores junk in the number boxes and clamps the commission', () => {
    expect(calculate(bill, 'abc', [{ title: 'x', sign: 1, amount: '??' }], undefined).final).toBe(700);
    expect(calculate(bill, '250', [], undefined).commissionPct).toBe(100);
    expect(calculate(bill, '-5', [], undefined).commissionPct).toBe(0);
  });
});

describe('profit and loss are shared: a win is a loss for both', () => {
  it('splits a day by the agent\'s share, the same way the server does', () => {
    expect(splitByShare(-1990, 1)).toEqual({ adminSlice: -1791, agentSlice: -199 });
    expect(splitByShare(1000, 1)).toEqual({ adminSlice: 900, agentSlice: 100 });
    expect(splitByShare(-1990, 0)).toEqual({ adminSlice: -1990, agentSlice: 0 });
    expect(splitByShare(-5, 1)).toEqual({ adminSlice: -5, agentSlice: 0 }); // half away from zero
  });

  it('makes your slice the amount that changes hands, and carries it through adjustments', () => {
    // Sridevi's day: bet 2210, winning 4200, the agent on a 9:1 split
    const bill = { totalBet: 2210, totalWin: 4200, agentShare: 1 };
    const c = calculate(bill, '', [{ title: 'Cash', sign: 1, amount: '100' }], undefined);
    expect(c.day).toBe(-1990);
    expect(c.adminSlice).toBe(-1791);
    expect(c.agentSlice).toBe(-199);
    expect(c.adminSlice + c.agentSlice).toBe(c.day);
    expect(c.chain[0].running).toBe(-1691); // -1791 + 100
    expect(c.final).toBe(-1691);
  });

  it('treats a bill with no share as before: you carry all of it', () => {
    const c = calculate({ totalBet: 1000, totalWin: 300 }, '', [], undefined);
    expect(c.adminSlice).toBe(700);
    expect(c.agentSlice).toBe(0);
  });

  it('reads the shared loss on the copied bill', () => {
    const bills = buildBills([row({ totalStaked: 2210, totalPayout: 4200, agentShare: 1 } as never)]);
    expect(bills[0].agentShare).toBe(1);
    const calc = calculate(bills[0], '', [], undefined);
    const text = billText(bills[0], '2026-11-23', calc, undefined);
    expect(text).toContain('Total bet: 2210');
    expect(text).toContain('Agent cut (10%): 221');
    expect(text).toContain('Remaining: 1989');
    expect(text).toContain('Total winning: 3780'); // 1989 + 1791: what you pay on the winners
    expect(text).toContain('Payment: -1791');
    expect(text).toContain('Agent bears: -199');
    expect(text).toContain('Final payment: -1791');
  });

  it('is exactly the 20% cut example: a 100 bet that wins costs you 80 x your rate', () => {
    // rate 9 both ways: you pay the agent at 9x, the agent pays its player at 9x
    const bill = { totalBet: 100, totalWin: 900, agentShare: 2 };
    const c = calculate(bill, '', [], undefined);
    expect(c.commissionPct).toBe(20);
    expect(c.commission).toBe(20); // the agent's cut of the 100
    expect(c.remaining).toBe(80); // what you settle on
    expect(c.winningOnRemaining).toBe(720); // 80 x 9
    expect(c.adminSlice).toBe(-640); // 80 - 720: you pay the agent
    expect(c.agentSlice).toBe(-160); // the agent bears the other 20% of the 800 loss
    expect(c.adminSlice + c.agentSlice).toBe(c.day);
    expect(dueLabel(c.adminSlice)).toBe('Payment');
  });

  it('ignores the manual commission box when the agent has a cut', () => {
    const c = calculate({ totalBet: 100, totalWin: 900, agentShare: 2 }, '50', [], undefined);
    expect(c.commissionPct).toBe(20);
  });
});

describe('billText', () => {
  it('reads like the bill on screen', () => {
    const bills = buildBills([row({})]);
    const calc = calculate(bills[0], '10', [], { type: 'due', amount: '50' });
    const text = billText(bills[0], '2026-11-23', calc, { type: 'due', amount: '50' });
    expect(text).toContain('agent_one - 2026-11-23');
    expect(text).toContain('Sridevi: bet 1000, win 300');
    expect(text).toContain('Commission (10%): 100');
    expect(text).toContain('Due: 600');
    expect(text).toContain('Old due: 50');
    expect(text).toContain('Final due: 650');
  });
});
