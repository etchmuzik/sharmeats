'use client';

import { useCallback, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { ITEM_FLAGS, type ItemFlag, type MenuItem, type MenuSection } from '@/lib/types';
import { permissionDeniedCopy } from '@/lib/capabilities';
import { Icon } from '../Icon';
import { useToast } from '../Toast';
import { Field, NumberField, TextArea } from './fields';
import { MenuCsvImporter } from './MenuCsvImporter';

/**
 * Menu manager for one restaurant: sections, each holding items. Every change
 * writes to Supabase under RLS and is live in the customer app at once.
 *
 * `editable` is the manager+ tier from migration 136 and is REQUIRED, not
 * defaulted — a security-shaped prop that defaults to `true` fails open the
 * moment someone adds a second call site and forgets it. There is exactly one
 * call site today (menu/page.tsx) and tsc now enforces it on any new one.
 *
 * When false, the caller is the 'staff' tier: they may still 86 an item
 * (menu_items.is_available is deliberately unprivileged in 136, because
 * stopping a sold-out dish must not wait for a manager), but every structural
 * and price control is hidden. The database refuses those writes regardless —
 * this only stops the merchant meeting a raw Postgres error to find out.
 */
export function MenuManager({
  restaurantId,
  editable,
}: {
  restaurantId: string;
  editable: boolean;
}) {
  const { toast } = useToast();
  const [sections, setSections] = useState<MenuSection[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const [{ data: secs, error: sectionsError }, { data: its, error: itemsError }] =
      await Promise.all([
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
    if (sectionsError || itemsError) {
      setLoading(false);
      toast('Could not refresh the menu. Check your connection and try again.', 'error');
      return false;
    }
    setSections((secs as MenuSection[]) ?? []);
    setItems((its as MenuItem[]) ?? []);
    setLoading(false);
    return true;
  }, [restaurantId, toast]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const addSection = async () => {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.rpc('append_merchant_menu_section', {
      p_restaurant_id: restaurantId,
      p_name: 'New section',
    });
    if (error) return toast(permissionDeniedCopy(error) ?? error.message, 'error');
    await load();
  };

  return (
    <section className="space-y-4 rounded-2xl border border-line bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink3">Menu</h2>
        {editable && (
          <button
            onClick={addSection}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:border-accent hover:text-accent"
          >
            <Icon name="plus" size={15} /> Add section
          </button>
        )}
      </div>

      {editable && !loading && (
        <MenuCsvImporter
          restaurantId={restaurantId}
          existingItems={items.flatMap((item) => {
            const section = sections.find((candidate) => candidate.id === item.section_id);
            return section ? [{ sectionName: section.name, itemName: item.name }] : [];
          })}
          onImported={load}
        />
      )}

      {loading ? (
        <div className="py-6 text-center text-sm text-ink3">Loading menu…</div>
      ) : sections.length === 0 ? (
        <div className="py-6 text-center text-sm text-ink3">
          {editable
            ? 'No sections yet. Add one to start building the menu.'
            : 'No menu sections yet. An owner or manager can add them.'}
        </div>
      ) : (
        sections.map((section) => (
          <SectionBlock
            key={section.id}
            section={section}
            items={items.filter((it) => it.section_id === section.id)}
            onChanged={async () => {
              await load();
            }}
            editable={editable}
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
  editable,
}: {
  section: MenuSection;
  items: MenuItem[];
  onChanged: () => void | Promise<void>;
  editable: boolean;
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
    if (error) return toast(permissionDeniedCopy(error) ?? error.message, 'error');
    await onChanged();
  };

  const deleteSection = async () => {
    if (!confirm(`Delete section "${section.name}" and all its items?`)) return;
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from('menu_sections').delete().eq('id', section.id);
    if (error) return toast(permissionDeniedCopy(error) ?? error.message, 'error');
    await onChanged();
  };

  return (
    <div className="rounded-xl border border-line">
      <div className="flex items-center gap-2 border-b border-line bg-bg px-3 py-2">
        {editable ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={renameSection}
            className="flex-1 bg-transparent text-sm font-bold outline-none"
          />
        ) : (
          <span className="flex-1 text-sm font-bold">{section.name}</span>
        )}
        {editable && (
          <>
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
          </>
        )}
      </div>

      <div>
        {items.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-ink3">No items in this section.</div>
        )}
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            onEdit={() => setEditing(item)}
            onChanged={onChanged}
            editable={editable}
          />
        ))}
      </div>

      {editing && (
        <ItemEditor
          restaurantId={section.restaurant_id}
          sectionId={section.id}
          item={editing === 'new' ? null : editing}
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
  editable,
}: {
  item: MenuItem;
  onEdit: () => void;
  onChanged: () => void | Promise<void>;
  editable: boolean;
}) {
  const { toast } = useToast();

  // NOT gated by `editable`. Migration 136 deliberately leaves is_available
  // unprivileged so the 'staff' tier can 86 a sold-out dish without hunting
  // for a manager — gating it here would remove the one action that tier
  // exists to protect. The DB permits this for every merchant_staff row.
  const toggleAvailable = async () => {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase
      .from('menu_items')
      .update({ is_available: !item.is_available })
      .eq('id', item.id);
    if (error) return toast(permissionDeniedCopy(error) ?? error.message, 'error');
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
      {editable && (
        <button
          onClick={onEdit}
          className="rounded-md px-1.5 py-1 text-ink3 hover:bg-accent/10 hover:text-accent"
          aria-label="Edit item"
        >
          <Icon name="edit" size={15} />
        </button>
      )}
    </div>
  );
}

function ItemEditor({
  restaurantId,
  sectionId,
  item,
  onClose,
  onSaved,
}: {
  restaurantId: string;
  sectionId: string;
  item: MenuItem | null;
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
      : await supabase.rpc('append_merchant_menu_item', {
          p_restaurant_id: restaurantId,
          p_section_id: sectionId,
          p_name: payload.name,
          p_description: payload.description,
          p_price_egp: payload.price_egp,
          p_image: payload.image,
          p_flags: payload.flags,
          p_is_available: payload.is_available,
        });
    setSaving(false);
    if (error) return toast(permissionDeniedCopy(error) ?? error.message, 'error');
    toast(item ? 'Item updated' : 'Item added', 'success');
    await onSaved();
  };

  const remove = async () => {
    if (!item) return onClose();
    if (!confirm(`Delete "${item.name}"?`)) return;
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from('menu_items').delete().eq('id', item.id);
    if (error) return toast(permissionDeniedCopy(error) ?? error.message, 'error');
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
