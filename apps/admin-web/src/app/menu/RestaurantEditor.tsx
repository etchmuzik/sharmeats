'use client';

import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  CUISINES,
  ZONES,
  type Cuisine,
  type Restaurant,
  type Zone,
} from '@/lib/types';
import { Icon } from '../Icon';
import { useToast } from '../Toast';
import { Field, NumberField, Toggle, TextArea } from './fields';
import { MenuManager } from './MenuManager';

/**
 * Full editor for one restaurant: its details form + its menu (sections/items).
 * Saves write straight to Supabase under admin RLS — live in the app instantly.
 */
export function RestaurantEditor({
  restaurant,
  onSaved,
  onDeleted,
}: {
  restaurant: Restaurant;
  onSaved: () => void | Promise<void>;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  // Local editable copy; reset whenever a different restaurant is opened.
  const [form, setForm] = useState<Restaurant>(restaurant);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setForm(restaurant);
  }, [restaurant]);

  const set = <K extends keyof Restaurant>(key: K, value: Restaurant[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleCuisine = (c: Cuisine) =>
    setForm((f) => ({
      ...f,
      cuisines: f.cuisines.includes(c)
        ? f.cuisines.filter((x) => x !== c)
        : [...f.cuisines, c],
    }));

  const save = async () => {
    if (saving) return;
    if (!form.name.trim()) {
      toast('Name is required', 'error');
      return;
    }
    if (!form.cover_image.trim()) {
      toast('Cover image URL is required', 'error');
      return;
    }
    setSaving(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase
      .from('restaurants')
      .update({
        name: form.name.trim(),
        description: form.description,
        cuisines: form.cuisines,
        cuisine_label: form.cuisine_label,
        cover_image: form.cover_image.trim(),
        logo: form.logo,
        zone: form.zone,
        prep_time_low: form.prep_time_low,
        prep_time_high: form.prep_time_high,
        delivery_fee_egp: form.delivery_fee_egp,
        min_order_egp: form.min_order_egp,
        tourist_safe: form.tourist_safe,
        is_open: form.is_open,
        is_open_24h: form.is_open_24h,
        featured: form.featured,
        promo: form.promo,
        is_active: form.is_active,
      })
      .eq('id', form.id);
    setSaving(false);
    if (error) {
      toast(error.message, 'error');
      return;
    }
    toast('Saved — live in the app now', 'success');
    await onSaved();
  };

  const remove = async () => {
    if (deleting) return;
    if (!confirm(`Delete "${form.name}" and its entire menu? This cannot be undone.`)) return;
    setDeleting(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from('restaurants').delete().eq('id', form.id);
    setDeleting(false);
    if (error) {
      toast(error.message, 'error');
      return;
    }
    toast('Restaurant deleted', 'success');
    onDeleted();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 pb-24">
      {/* Quick status row — the things you flip most often */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white p-4">
        <Toggle
          label="Visible in app"
          checked={form.is_active}
          onChange={(v) => set('is_active', v)}
        />
        <Toggle label="Open now" checked={form.is_open} onChange={(v) => set('is_open', v)} />
        <Toggle
          label="Tourist-safe"
          checked={form.tourist_safe}
          onChange={(v) => set('tourist_safe', v)}
        />
        <Toggle
          label="Featured"
          checked={form.featured ?? false}
          onChange={(v) => set('featured', v)}
        />
      </div>

      {/* Details */}
      <section className="space-y-4 rounded-2xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink3">Details</h2>
        <Field label="Name" value={form.name} onChange={(v) => set('name', v)} required />
        <TextArea
          label="Description"
          value={form.description}
          onChange={(v) => set('description', v)}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Cover image URL"
            value={form.cover_image}
            onChange={(v) => set('cover_image', v)}
            required
            placeholder="https://…"
          />
          <Field
            label="Logo URL"
            value={form.logo ?? ''}
            onChange={(v) => set('logo', v || null)}
            placeholder="https://… (optional)"
          />
        </div>
        {form.cover_image && (
          <div
            className="h-32 w-full rounded-xl bg-sand bg-cover bg-center"
            style={{ backgroundImage: `url(${form.cover_image})` }}
          />
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink2">Zone</span>
            <select
              value={form.zone}
              onChange={(e) => set('zone', e.target.value as Zone)}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
            >
              {ZONES.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Cuisine label"
            value={form.cuisine_label}
            onChange={(v) => set('cuisine_label', v)}
            placeholder="e.g. Egyptian · Koshary"
          />
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-semibold text-ink2">Cuisines</span>
          <div className="flex flex-wrap gap-2">
            {CUISINES.map((c) => {
              const on = form.cuisines.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCuisine(c)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    on ? 'border-accent bg-accent text-white' : 'border-line text-ink2'
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Economics */}
      <section className="space-y-4 rounded-2xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink3">
          Delivery & timing
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <NumberField
            label="Delivery fee (EGP)"
            value={form.delivery_fee_egp}
            onChange={(v) => set('delivery_fee_egp', v)}
          />
          <NumberField
            label="Min order (EGP)"
            value={form.min_order_egp}
            onChange={(v) => set('min_order_egp', v)}
          />
          <NumberField
            label="Prep min (min)"
            value={form.prep_time_low}
            onChange={(v) => set('prep_time_low', v)}
          />
          <NumberField
            label="Prep max (min)"
            value={form.prep_time_high}
            onChange={(v) => set('prep_time_high', v)}
          />
        </div>
        <Field
          label="Promo banner text"
          value={form.promo ?? ''}
          onChange={(v) => set('promo', v || null)}
          placeholder="e.g. -20% today (optional)"
        />
      </section>

      {/* Menu */}
      <MenuManager restaurantId={form.id} />

      {/* Sticky save bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 px-6 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <button
            onClick={remove}
            disabled={deleting}
            className="flex items-center gap-1.5 rounded-lg border border-red px-3.5 py-2 text-sm font-semibold text-red disabled:opacity-60"
          >
            <Icon name="trash" size={15} /> Delete
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-accent px-6 py-2.5 text-sm font-bold text-white disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
