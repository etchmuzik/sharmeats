import type { RewardsHistoryEntry, RewardsStatus } from '../types';

const delay = <T>(value: T, ms = 40): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

let status: RewardsStatus = { tier: 'silver', pointsBalance: 340, pointsRolling12mo: 620 };
let creditEgp = 50; // demo: a prior late-delivery credit

const history: RewardsHistoryEntry[] = [
  { id: 'h1', deltaPoints: 25, reason: 'order_earn', refOrderId: 'order-1', createdAt: Date.now() - 86400000 },
  { id: 'h2', deltaPoints: -100, reason: 'redeem', refOrderId: null, createdAt: Date.now() - 172800000 },
];

export const rewardsRepo = {
  async getStatus(): Promise<RewardsStatus> {
    return delay(status);
  },
  async listHistory(limit = 20): Promise<RewardsHistoryEntry[]> {
    return delay(history.slice(0, limit));
  },
  async redeem(points: number): Promise<string> {
    if (points == null || points <= 0) throw new Error('INVALID_POINTS');
    if (points > status.pointsBalance) throw new Error('INSUFFICIENT_POINTS');
    status = { ...status, pointsBalance: status.pointsBalance - points };
    history.unshift({ id: `h${history.length + 1}`, deltaPoints: -points, reason: 'redeem', refOrderId: null, createdAt: Date.now() });
    return delay('LOY-DEMO42');
  },
  async getCreditBalanceEgp(): Promise<number> {
    return delay(creditEgp);
  },
  async redeemCredit(amountEgp: number): Promise<string> {
    if (amountEgp == null || amountEgp <= 0) throw new Error('INVALID_AMOUNT');
    if (amountEgp > creditEgp) throw new Error('INSUFFICIENT_CREDIT');
    creditEgp -= amountEgp;
    return delay('CR-DEMO42');
  },
};
