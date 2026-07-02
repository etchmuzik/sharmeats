import { getSupabase } from './client';
import { rowToRewardsHistoryEntry, rowToRewardsStatus } from './mappers';
import type { RewardsHistoryEntry, RewardsStatus } from '../types';

export const rewardsRepoSupabase = {
  async getStatus(): Promise<RewardsStatus> {
    const { data, error } = await getSupabase().rpc('my_loyalty_status');
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { tier: 'bronze', pointsBalance: 0, pointsRolling12mo: 0 };
    return rowToRewardsStatus(row);
  },

  async listHistory(limit = 20): Promise<RewardsHistoryEntry[]> {
    const { data, error } = await getSupabase().rpc('my_loyalty_history', { p_limit: limit });
    if (error) throw error;
    return (data ?? []).map(rowToRewardsHistoryEntry);
  },

  async redeem(points: number): Promise<string> {
    const { data, error } = await getSupabase().rpc('redeem_points', { p_points: points });
    if (error) throw error;
    if (typeof data !== 'string' || data.length === 0) throw new Error('Redeem failed');
    return data;
  },
};
