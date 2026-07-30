import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MenuManager } from './MenuManager';

const rpc = vi.fn();
const directInsert = vi.fn();
const toast = vi.fn();

const sections = [
  {
    id: 'section-1',
    restaurant_id: 'restaurant-1',
    name: 'Mains',
    sort_order: 7,
  },
];

function selectResult(table: string) {
  return table === 'menu_sections'
    ? { data: sections, error: null }
    : { data: [], error: null };
}

const from = vi.fn((table: string) => ({
  select: vi.fn(() => ({
    eq: vi.fn(() => ({
      order: vi.fn(async () => selectResult(table)),
    })),
  })),
  insert: directInsert,
}));

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({ from, rpc }),
}));

vi.mock('../Toast', () => ({
  useToast: () => ({ toast }),
}));

describe('MenuManager locked append paths', () => {
  beforeEach(() => {
    from.mockClear();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: 'new-id', error: null });
    directInsert.mockReset();
    directInsert.mockResolvedValue({ data: null, error: null });
    toast.mockReset();
  });

  it('appends a section through the transactional RPC instead of a direct table insert', async () => {
    render(<MenuManager restaurantId="restaurant-1" editable />);

    fireEvent.click(await screen.findByRole('button', { name: /Add section/i }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('append_merchant_menu_section', {
        p_restaurant_id: 'restaurant-1',
        p_name: 'New section',
      }),
    );
    expect(directInsert).not.toHaveBeenCalled();
  });

  it('appends an item through the transactional RPC without sending a stale client sort order', async () => {
    render(<MenuManager restaurantId="restaurant-1" editable />);

    fireEvent.click(await screen.findByRole('button', { name: /^Item$/i }));
    fireEvent.change(screen.getByLabelText(/Item name/i), {
      target: { value: 'Grilled fish' },
    });
    fireEvent.change(screen.getByLabelText('Price (EGP)'), {
      target: { value: '240' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('append_merchant_menu_item', {
        p_restaurant_id: 'restaurant-1',
        p_section_id: 'section-1',
        p_name: 'Grilled fish',
        p_description: '',
        p_price_egp: 240,
        p_image: '',
        p_flags: [],
        p_is_available: true,
      }),
    );
    expect(directInsert).not.toHaveBeenCalled();
  });
});
