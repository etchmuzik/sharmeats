import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({ rpc }),
}));

const { ScorecardCard } = await import('./ScorecardCard');

/** A row shaped exactly as restaurant_scorecard (077:21-35) returns it. */
function row(over: Record<string, number | null> = {}) {
  return {
    restaurant_id: 'r1',
    window_days: 30,
    orders: 40,
    accepted: 38,
    rejected: 2,
    cancelled: 0,
    delivered: 36,
    acceptance_rate: 0.95,
    reject_rate: 0.05,
    cancel_rate: 0,
    on_time_rate: 0.83,
    avg_prep_minutes: 17.4,
    // 4.6, not 4.35: `(4.35).toFixed(1)` is "4.3", because 4.35 is not exactly
    // representable in binary floating point and toFixed rounds the stored
    // value, not the decimal literal. Harmless for a displayed rating, but a
    // test asserting "4.4" would fail for a reason that has nothing to do with
    // this component.
    avg_food_rating: 4.6,
    ...over,
  };
}

describe('ScorecardCard', () => {
  it('renders the metrics a trading restaurant has', async () => {
    rpc.mockResolvedValueOnce({ data: [row()], error: null });
    render(<ScorecardCard restaurantId="r1" />);

    await waitFor(() => screen.getByText('95%')); // acceptance
    expect(screen.getByText('83%')).toBeInTheDocument(); // on time
    expect(screen.getByText('17 min')).toBeInTheDocument(); // avg prep, rounded
    expect(screen.getByText('4.6')).toBeInTheDocument(); // food rating, 1dp
    expect(screen.getByText('40')).toBeInTheDocument(); // orders
  });

  /**
   * The day-one case, and the one a naive implementation gets wrong. 077 guards
   * every denominator with nullif(), so a restaurant with no delivered orders
   * returns ONE row of nulls. Rendering "0%" there would tell a brand-new
   * merchant their acceptance rate is catastrophic; "NaN%" would be worse.
   */
  it('never shows 0% or NaN for a restaurant with no data yet', async () => {
    rpc.mockResolvedValueOnce({
      data: [
        row({
          orders: 0,
          delivered: 0,
          acceptance_rate: null,
          reject_rate: null,
          cancel_rate: null,
          on_time_rate: null,
          avg_prep_minutes: null,
          avg_food_rating: null,
        }),
      ],
      error: null,
    });
    const { container } = render(<ScorecardCard restaurantId="r1" />);

    await waitFor(() => screen.getByText(/no orders yet/i));
    expect(container.textContent).not.toMatch(/NaN/);
    expect(container.textContent).not.toMatch(/0%/);
  });

  /**
   * Partial nulls: orders exist but none delivered yet, so on-time and prep are
   * null while acceptance is real. Each metric must degrade independently.
   */
  it('shows a dash for individual metrics that have no data', async () => {
    rpc.mockResolvedValueOnce({
      data: [row({ delivered: 0, on_time_rate: null, avg_prep_minutes: null, avg_food_rating: null })],
      error: null,
    });
    const { container } = render(<ScorecardCard restaurantId="r1" />);

    await waitFor(() => screen.getByText('95%'));
    expect(container.textContent).not.toMatch(/NaN/);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  /**
   * 077:44 raises NOT_AUTHORIZED for someone who is not staff of this
   * restaurant. That is not a fault worth an error box — render nothing.
   */
  it('renders no error box when the caller is not authorized', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'NOT_AUTHORIZED', code: '23514' },
    });
    const { container } = render(<ScorecardCard restaurantId="r1" />);

    await waitFor(() => {
      expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
      expect(container).toBeEmptyDOMElement();
    });
  });

  /** A real failure must be surfaced, not silently swallowed. */
  it('surfaces a genuine load failure', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } });
    render(<ScorecardCard restaurantId="r1" />);
    await waitFor(() => screen.getByText(/couldn't load/i));
  });

  /** Defensive: an empty array hides rather than leaving a permanent skeleton. */
  it('hides an empty result set', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    const { container } = render(<ScorecardCard restaurantId="r1" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
