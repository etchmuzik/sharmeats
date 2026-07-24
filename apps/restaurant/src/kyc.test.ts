import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const upload = vi.fn();
  const remove = vi.fn();
  const insert = vi.fn();
  const supabase = {
    auth: {
      getUser: vi.fn(),
    },
    storage: {
      from: vi.fn(() => ({ upload, remove })),
    },
    from: vi.fn(() => ({ insert })),
    rpc: vi.fn(),
  };
  return { upload, remove, insert, supabase };
});

vi.mock('./supabase', () => ({
  getSupabase: () => mocks.supabase,
}));

vi.mock('./orders', () => ({
  getMyRestaurant: vi.fn(async () => ({
    restaurantId: 'restaurant-1',
    restaurantName: 'Test Kitchen',
    isOpen: true,
    staffRole: 'owner',
  })),
}));

import { uploadKycDocument, validateRestaurantKycUpload } from './kyc';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.supabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
  });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.insert.mockResolvedValue({ error: null });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ blob: async () => new Blob(['image'], { type: 'image/jpeg' }) })),
  );
});

describe('restaurant KYC upload', () => {
  it('uses insert-only object storage so reviewed evidence cannot be overwritten', async () => {
    await uploadKycDocument('tax_card', 'file:///tax.jpg', 5678);

    expect(mocks.upload).toHaveBeenCalledWith(
      'user-1/restaurant-tax_card-5678.jpg',
      expect.any(Blob),
      {
        contentType: 'image/jpeg',
        upsert: false,
      },
    );
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        subject_type: 'restaurant',
        subject_id: 'restaurant-1',
        doc_type: 'tax_card',
        storage_path: 'user-1/restaurant-tax_card-5678.jpg',
      }),
    );
  });

  it('rejects document types that are not part of restaurant KYC', () => {
    expect(() => validateRestaurantKycUpload('national_id', 'image/jpeg', 100)).toThrow(
      'Unsupported restaurant document type',
    );
  });

  it('removes an uploaded orphan if the metadata row cannot be recorded', async () => {
    mocks.insert.mockResolvedValueOnce({ error: new Error('row rejected') });

    await expect(uploadKycDocument('tax_card', 'file:///tax.jpg', 5678)).rejects.toThrow(
      'row rejected',
    );
    expect(mocks.remove).toHaveBeenCalledWith(['user-1/restaurant-tax_card-5678.jpg']);
  });
});
