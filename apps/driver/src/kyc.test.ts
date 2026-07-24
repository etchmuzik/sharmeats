import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const upload = vi.fn();
  const remove = vi.fn();
  const insert = vi.fn();
  const single = vi.fn();
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  const supabase = {
    auth: {
      getUser: vi.fn(),
    },
    storage: {
      from: vi.fn(() => ({ upload, remove })),
    },
    from: vi.fn((table: string) =>
      table === 'drivers' ? { select } : { insert },
    ),
    rpc: vi.fn(),
  };
  return { upload, remove, insert, single, eq, select, supabase };
});

vi.mock('./supabase', () => ({
  getSupabase: () => mocks.supabase,
}));

import { validateDriverKycUpload, uploadKycDocument } from './kyc';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.supabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
  });
  mocks.single.mockResolvedValue({ data: { id: 'driver-1' }, error: null });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.insert.mockResolvedValue({ error: null });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ blob: async () => new Blob(['image'], { type: 'image/jpeg' }) })),
  );
});

describe('driver KYC upload', () => {
  it('uses insert-only object storage so reviewed evidence cannot be overwritten', async () => {
    await uploadKycDocument('national_id', 'file:///id.jpg', 1234);

    expect(mocks.upload).toHaveBeenCalledWith(
      'user-1/driver-national_id-1234.jpg',
      expect.any(Blob),
      {
        contentType: 'image/jpeg',
        upsert: false,
      },
    );
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        subject_type: 'driver',
        subject_id: 'driver-1',
        doc_type: 'national_id',
        storage_path: 'user-1/driver-national_id-1234.jpg',
      }),
    );
  });

  it('rejects unknown document types and files outside the private bucket contract', () => {
    expect(() => validateDriverKycUpload('passport', 'image/jpeg', 100)).toThrow(
      'Unsupported driver document type',
    );
    expect(() => validateDriverKycUpload('national_id', 'application/pdf', 100)).toThrow(
      'Upload a JPEG, PNG, or WebP image',
    );
    expect(() => validateDriverKycUpload('national_id', 'image/jpeg', 5 * 1024 * 1024 + 1)).toThrow(
      'smaller than 5 MB',
    );
  });

  it('removes an uploaded orphan if the metadata row cannot be recorded', async () => {
    mocks.insert.mockResolvedValueOnce({ error: new Error('row rejected') });

    await expect(uploadKycDocument('national_id', 'file:///id.jpg', 1234)).rejects.toThrow(
      'row rejected',
    );
    expect(mocks.remove).toHaveBeenCalledWith(['user-1/driver-national_id-1234.jpg']);
  });
});
