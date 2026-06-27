'use client';

import { useCallback, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { ITEM_FLAGS, type ItemFlag, type MenuItem, type MenuSection } from '@/lib/types';
import { Icon } from '../Icon';
import { useToast } from '../Toast';
import { Field, NumberField, TextArea } from './fields';

/**
 * Menu manager for one restaurant: sections, each holding items. Every change
 * writes to Supabase under admin RLS and is live in the customer app at once.
 */
export function MenuManager({ restaurantId }: { restaurantId: string }) {
  const { toast } = useToast();
  const [sections, setSections] = useState<MenuSection[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const [{ data: secs }, { data: its }] = await Promise.all([
      supabase
        .from('menu_sections')
        .select('id, restaurant_id, name, sort_order')
        .eq('restaurant_id', restaurantId)
        .order('sort_order', { ascending: true }),
      supabase
        .from('menu_items')
        .select(
          'id, restaurant_id, section_id, name, description, price_egp, image, flags, is_available, sort_order',
        )
        .eq('restaurant_id', restaurantId)
        .order('sort_order', { ascending: true }),
    ]);
    setSections((secs as MenuSection[]) ?? []);
    setItems((its as MenuItem[]) ?? []);
    setLoading(false);
  }, [restaurantId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const addSection = async () => {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from('menu_sections').insert({
      restaurant_id: restaurantId,
      name: 'New section',
      sort_order: sections.length,
    });
    if (error) return toast(error.message, 'error');
    await load();
  };

  return (
    <section className="space-y-4 rounded-2xl border border-line bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink3">Menu</h2>
        <button
          onClick={addSection}
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:border-accent hover:text-accent"
        >
          <Icon name="plus" size={15} /> Add section
        </button>
      </div>

      {loading ? (
        <div className="py-6 text-center text-sm text-ink3">Loading menu…</div>
      ) : sections.length === 0 ? (
        <div className="py-6 text-center text-sm text-ink3">
          No sections yet. Add one to start building the menu.
        </div>
      ) : (
        sections.map((section) => (
          <SectionBlock
            key={section.id}
            section={section}
            items={items.filter((it) => it.section_id === section.id)}
            onChanged={load}
          />
        ))
      )}
    </section>
  );
}

function SectionBlock({
  section,
  items,
  onChanged,
}: {
  section: MenuSection;
  items: MenuItem[];
  onChanged: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(section.name);
  const [editing, setEditing] = useState<MenuItem | 'new' | null>(null);

  useEffect(() => setName(section.name), [section.name]);

  const renameSection = async () => {
    if (name.trim() === section.name) return;
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase
      .from('menu_sections')
      .update({ name: name.trim() || 'Section' })
      .eq('id', section.id);
    if (error) return toast(error.message, 'error');
    await onChanged();
  };

  const deleteSection = async () => {
    if (!confirm(`Delete section "${section.name}" and all its items?`)) return;
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from('menu_sections').delete().eq('id', section.id);
    if (error) return toast(error.message, 'error');
    await onChanged();
  };

  return (
    <div className="rounded-xl border border-line">
      <div className="flex items-center gap-2 border-b border-line bg-bg px-3 py-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={renameSection}
          className="flex-1 bg-transparent text-sm font-bold outline-none"
        />
        <button
          onClick={() => setEditing('new')}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-accent hover:bg-accent/10"
        >
          <Icon name="plus" size={13} /> Item
        </button>
        <button
          onClick={deleteSection}
          className="rounded-md px-1.5 py-1 text-ink3 hover:bg-red/10 hover:text-red"
          aria-label="Delete section"
        >
          <Icon name="trash" size={14} />
        </button>
      </div>

      <div>
        {items.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-ink3">No items in this section.</div>
        )}
        {items.map((item) => (
          <ItemRow key={item.id} item={item} onEdit={() => setEditing(item)} onChanged={onChanged} />
        ))}
      </div>

      {editing && (
        <ItemEditor
          restaurantId={section.restaurant_id}
          sectionId={section.id}
          item={editing === 'new' ? null : editing}
          sortOrder={items.length}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

function ItemRow({
  item,
  onEdit,
  onChanged,
}: {
  item: MenuItem;
  onEdit: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const { toast } = useToast();

  const toggleAvailable = async () => {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase
      .from('menu_items')
      .update({ is_available: !item.is_available })
      .eq('id', item.id);
    if (error) return toast(error.message, 'error');
    await onChanged();
  };

  return (
    <div
      className={`flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0 ${
        item.is_available ? '' : 'opacity-55'
      }`}
    >
      <div
        className="h-10 w-10 flex-shrink-0 rounded-md bg-sand bg-cover bg-center"
        style={item.image ? { backgroundImage: `url(${item.image})` } : undefined}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{item.name}</div>
        {item.description && (
          <div className="truncate text-xs text-ink3">{item.description}</div>
        )}
      </div>
      <div className="text-sm font-bold tabular-nums">{item.price_egp} EGP</div>
      <button
        onClick={toggleAvailable}
        className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase ${
          item.is_available ? 'bg-greensoft text-green' : 'bg-sand text-ink3'
        }`}
      >
        {item.is_available ? 'In stock' : 'Out'}
      </button>
      <button
        onClick={onEdit}
        className="rounded-md px-1.5 py-1 text-ink3 hover:bg-accent/10 hover:text-accent"
        aria-label="Edit item"
      >
        <Icon name="edit" size={15} />
      </button>
    </div>
  );
}

function ItemEditor({
  restaurantId,
  sectionId,
  item,
  sortOrder,
  onClose,
  onSaved,
}: {
  restaurantId: string;
  sectionId: string;
  item: MenuItem | null;
  sortOrder: number;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [price, setPrice] = useState(item?.price_egp ?? 0);
  const [image, setImage] = useState(item?.image ?? '');
  const [flags, setFlags] = useState<ItemFlag[]>(item?.flags ?? []);
  const [available, setAvailable] = useState(item?.is_available ?? true);
  const [saving, setSaving] = useState(false);

  const toggleFlag = (f: ItemFlag) =>
    setFlags((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));

  const save = async () => {
    if (saving) return;
    if (!name.trim()) return toast('Item name is required', 'error');
    setSaving(true);
    const supabase = createSupabaseBrowserClient();
    const payload = {
      restaurant_id: restaurantId,
      section_id: sectionId,
      name: name.trim(),
      description,
      price_egp: Math.max(0, price),
      image,
      flags,
      is_available: available,
    };
    const { error } = item
      ? await supabase.from('menu_items').update(payload).eq('id', item.id)
      : await supabase.from('menu_items').insert({ ...payload, sort_order: sortOrder });
    setSaving(false);
    if (error) return toast(error.message, 'error');
    toast(item ? 'Item updated' : 'Item added', 'success');
    await onSaved();
  };

  const remove = async () => {
    if (!item) return onClose();
    if (!confirm(`Delete "${item.name}"?`)) return;
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from('menu_items').delete().eq('id', item.id);
    if (error) return toast(error.message, 'error');
    toast('Item deleted', 'success');
    await onSaved();
  };

  return (
    <div className="space-y-3 border-t-2 border-accent/30 bg-bg p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Field label="Item name" value={name} onChange={setName} required />
        </div>
        <NumberField label="Price (EGP)" value={price} onChange={setPrice} />
      </div>
      <TextArea label="Description" value={description} onChange={setDescription} />
      <Field label="Image URL" value={image} onChange={setImage} placeholder="https://… (optional)" />

      <div>
        <span className="mb-1.5 block text-sm font-semibold text-ink2">Flags</span>
        <div className="flex flex-wrap gap-1.5">
          {ITEM_FLAGS.map((f) => {
            const on = flags.includes(f);
            return (
              <button
                key={f}
                type="button"
                onClick={() => toggleFlag(f)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                  on ? 'border-sea bg-sea text-white' : 'border-line text-ink3'
                }`}
              >
                {f}
              </button>
            );
          })}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm font-semibold text-ink2">
        <input
          type="checkbox"
          checked={available}
          onChange={(e) => setAvailable(e.target.checked)}
          className="h-4 w-4 accent-green"
        />
        In stock (available to order)
      </label>

      <div className="flex items-center justify-between pt-1">
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink2"
          >
            Cancel
          </button>
          {item && (
            <button
              onClick={remove}
              className="rounded-lg border border-red px-3 py-1.5 text-sm font-semibold text-red"
            >
              Delete
            </button>
          )}
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-accent px-5 py-1.5 text-sm font-bold text-white disabled:opacity-60"
        >
          {saving ? 'Saving…' : item ? 'Update item' : 'Add item'}
        </button>
      </div>
    </div>
  );
}
