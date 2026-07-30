import { getSupabase } from './client';
import type { AcquisitionRepository } from '../types';

/** Live acquisition repository (mig 183). Both RPCs are fire-and-forget-safe:
 * they validate/degrade server-side and never return data. */
export const acquisitionRepoSupabase: AcquisitionRepository = {
  async recordTouch(t): Promise<void> {
    const { error } = await getSupabase().rpc('record_acquisition_touch', {
      p_install_id: t.installId,
      p_source: t.source,
      p_medium: null,
      p_campaign: t.campaign,
      p_partner_code: t.partnerCode,
      p_deep_link: t.deepLink,
    });
    if (error) throw error;
  },
  async claim(installId: string): Promise<void> {
    const { error } = await getSupabase().rpc('claim_acquisition_touches', {
      p_install_id: installId,
    });
    if (error) throw error;
  },
};
