import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MenuCsvImporter } from './MenuCsvImporter';

const rpc = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({ rpc }),
}));

vi.mock('../Toast', () => ({
  useToast: () => ({ toast }),
}));

function csvFile(contents: string) {
  return new File([contents], 'menu.csv', { type: 'text/csv' });
}

const validCsv = [
  'section_name,item_name,description,price_egp,image_url,flags,is_available',
  'Mains,Chicken shawarma,Garlic sauce and pickles,180,,spicy,true',
  'Drinks,Mango juice,,75,,,true',
].join('\n');

describe('MenuCsvImporter', () => {
  beforeEach(() => {
    rpc.mockReset();
    toast.mockReset();
  });

  it('validates locally and previews rows before any database write', async () => {
    render(
      <MenuCsvImporter
        restaurantId="restaurant-1"
        existingItems={[]}
        onImported={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Choose menu CSV'), {
      target: { files: [csvFile(validCsv)] },
    });

    expect(await screen.findByText('2 items across 2 sections')).toBeInTheDocument();
    expect(screen.getByText('Chicken shawarma')).toBeInTheDocument();
    expect(screen.getByText('Mango juice')).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('shows row errors and does not expose the import action for an invalid file', async () => {
    render(
      <MenuCsvImporter
        restaurantId="restaurant-1"
        existingItems={[]}
        onImported={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Choose menu CSV'), {
      target: {
        files: [
          csvFile(
            [
              'section_name,item_name,description,price_egp,image_url,flags,is_available',
              'Mains,Falafel,,free,,,true',
            ].join('\n'),
          ),
        ],
      },
    });

    expect(
      await screen.findByText(/Price must be a whole number from 1 to 10,000 EGP\./),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Import 1 item/i })).not.toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls the atomic RPC once and clears the preview only after success', async () => {
    const onImported = vi.fn();
    rpc.mockResolvedValue({
      data: { items_created: 2, sections_created: 2, sections_reused: 0 },
      error: null,
    });
    render(
      <MenuCsvImporter
        restaurantId="restaurant-1"
        existingItems={[]}
        onImported={onImported}
      />,
    );

    fireEvent.change(screen.getByLabelText('Choose menu CSV'), {
      target: { files: [csvFile(validCsv)] },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Import 2 items' }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('import_merchant_menu', {
        p_restaurant_id: 'restaurant-1',
        p_rows: [
          {
            section_name: 'Mains',
            item_name: 'Chicken shawarma',
            description: 'Garlic sauce and pickles',
            price_egp: 180,
            image: '',
            flags: ['spicy'],
            is_available: true,
          },
          {
            section_name: 'Drinks',
            item_name: 'Mango juice',
            description: '',
            price_egp: 75,
            image: '',
            flags: [],
            is_available: true,
          },
        ],
      }),
    );
    expect(onImported).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith('Imported 2 menu items', 'success');
    expect(screen.queryByText('Chicken shawarma')).not.toBeInTheDocument();
  });

  it('refreshes after an uncertain RPC outcome and tells the merchant to check before retrying', async () => {
    const onImported = vi.fn();
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'CSV_IMPORT_INVALID: item already exists' },
    });
    render(
      <MenuCsvImporter
        restaurantId="restaurant-1"
        existingItems={[]}
        onImported={onImported}
      />,
    );

    fireEvent.change(screen.getByLabelText('Choose menu CSV'), {
      target: { files: [csvFile(validCsv)] },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Import 2 items' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The import outcome could not be confirmed. The menu was refreshed—check it before retrying. CSV_IMPORT_INVALID: item already exists',
    );
    expect(onImported).toHaveBeenCalledOnce();
    expect(screen.getByText('Chicken shawarma')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 2 items' })).toBeEnabled();
  });

  it('revalidates the preview against refreshed menu items after an RPC error', async () => {
    const onImported = vi.fn();
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'Failed to fetch' },
    });
    const { rerender } = render(
      <MenuCsvImporter
        restaurantId="restaurant-1"
        existingItems={[]}
        onImported={onImported}
      />,
    );

    fireEvent.change(screen.getByLabelText('Choose menu CSV'), {
      target: { files: [csvFile(validCsv)] },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Import 2 items' }));
    await waitFor(() => expect(onImported).toHaveBeenCalledOnce());

    rerender(
      <MenuCsvImporter
        restaurantId="restaurant-1"
        existingItems={[{ sectionName: 'Mains', itemName: 'Chicken shawarma' }]}
        onImported={onImported}
      />,
    );

    expect(await screen.findByText(/This item already exists: Mains \/ Chicken shawarma\./))
      .toBeInTheDocument();
    expect(
      screen.getByText(/The import outcome could not be confirmed\./),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import 2 items' })).not.toBeInTheDocument();
  });
});
