import { describe, it, expect, beforeEach } from 'vitest';
import { savedOrdersRepo, SAVED_ORDERS_CAP, SavedOrdersCapError, __resetSavedOrders } from './savedOrders';
import type { CartItem } from '../types';

const line: CartItem = {
  lineId: 'l1',
  itemId: 'i1',
  restaurantId: 'r1',
  name: 'Koshari',
  basePriceEgp: 40,
  image: '',
  quantity: 1,
  modifierChoices: [],
};

const input = (name: string) => ({
  restaurantId: 'r1',
  restaurantName: 'Koshari Al Tahrir',
  name,
  items: [line],
});

describe('savedOrders mock repo', () => {
  beforeEach(() => __resetSavedOrders());

  it('saves and lists newest-first', async () => {
    await savedOrdersRepo.save(input('First'));
    await savedOrdersRepo.save(input('Second'));
    const list = await savedOrdersRepo.list();
    expect(list.map((s) => s.name)).toEqual(['Second', 'First']);
  });

  it('rejects the 6th save with SavedOrdersCapError', async () => {
    for (let i = 0; i < SAVED_ORDERS_CAP; i += 1) {
      await savedOrdersRepo.save(input(`n${i}`));
    }
    await expect(savedOrdersRepo.save(input('overflow'))).rejects.toBeInstanceOf(SavedOrdersCapError);
  });

  it('remove frees a slot', async () => {
    for (let i = 0; i < SAVED_ORDERS_CAP; i += 1) {
      await savedOrdersRepo.save(input(`n${i}`));
    }
    const list = await savedOrdersRepo.list();
    await savedOrdersRepo.remove(list[0].id);
    await expect(savedOrdersRepo.save(input('now-fits'))).resolves.toBeTruthy();
  });
});
