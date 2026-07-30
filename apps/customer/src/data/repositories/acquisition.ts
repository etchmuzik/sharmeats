import type { AcquisitionRepository } from '../types';

/** Mock acquisition repository: accepts and forgets — the capture pipeline is
 * exercised, nothing persists. */
export const acquisitionRepo: AcquisitionRepository = {
  async recordTouch(): Promise<void> {},
  async claim(): Promise<void> {},
};
