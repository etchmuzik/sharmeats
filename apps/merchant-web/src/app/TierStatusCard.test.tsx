import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TierStatusCard } from './TierStatusCard';

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({
    rpc: vi.fn().mockResolvedValue({
      data: [{ tier: 'silver', orders_rolling_90d: 62, commission_pct: 11.0, featured: false }],
      error: null,
    }),
  }),
}));

describe('TierStatusCard', () => {
  it('renders the fetched tier status', async () => {
    render(<TierStatusCard />);
    await waitFor(() => screen.getByText(/silver/i));
    expect(screen.getByText(/62/)).toBeInTheDocument();
    expect(screen.getByText(/11(\.0)?%/)).toBeInTheDocument();
  });
});
