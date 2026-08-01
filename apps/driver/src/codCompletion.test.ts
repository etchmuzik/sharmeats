import { describe, expect, it, vi } from 'vitest';
import { completeCodDelivery } from './jobs';

// Regression guard for the production incident where the driver app collected
// cash BEFORE advancing to 'delivered', which mig 202 F-06's mark_cod_collected
// rejects — breaking every COD delivery (the dominant payment rail).
describe('completeCodDelivery ordering', () => {
  it('advances to delivered BEFORE collecting cash', async () => {
    const calls: string[] = [];
    const advance = vi.fn(async () => {
      calls.push('advance');
    });
    const collectCod = vi.fn(async () => {
      calls.push('collect');
    });

    await completeCodDelivery('order-1', 250, { advance, collectCod });

    expect(calls).toEqual(['advance', 'collect']);
    expect(advance).toHaveBeenCalledWith('order-1', 'delivered');
    expect(collectCod).toHaveBeenCalledWith('order-1', 250);
  });

  it('does not collect cash if the advance fails', async () => {
    const advance = vi.fn(async () => {
      throw new Error('illegal transition');
    });
    const collectCod = vi.fn(async () => {});

    await expect(completeCodDelivery('order-1', 250, { advance, collectCod })).rejects.toThrow();
    expect(collectCod).not.toHaveBeenCalled();
  });

  it('propagates a collect failure after a successful advance (caller must offer retry)', async () => {
    const advance = vi.fn(async () => {});
    const collectCod = vi.fn(async () => {
      throw new Error('COD_NOT_COLLECTABLE');
    });

    await expect(completeCodDelivery('order-1', 250, { advance, collectCod })).rejects.toThrow(
      /COD_NOT_COLLECTABLE/,
    );
    // Advance already happened — the order is delivered, only settlement failed.
    expect(advance).toHaveBeenCalledOnce();
  });
});
