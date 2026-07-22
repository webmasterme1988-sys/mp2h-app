'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchAllAddons, type Addon } from '@/lib/addons';
import { formatPrice } from '@/lib/priceTiers';

interface AddonDraft {
  name: string;
  price: string;
  max_quantity: string;
  active: boolean;
}

function draftFromAddon(addon: Addon): AddonDraft {
  return {
    name: addon.name,
    price: String(addon.price),
    max_quantity: String(addon.max_quantity),
    active: addon.active,
  };
}

export default function AddonsTab() {
  const [addons, setAddons] = useState<Addon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, AddonDraft>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newMaxQuantity, setNewMaxQuantity] = useState('4');
  const [adding, setAdding] = useState(false);

  const fetchAddons = useCallback(async () => {
    setLoading(true);
    setError(null);
    const list = await fetchAllAddons(supabase);
    setAddons(list);
    setDrafts(Object.fromEntries(list.map((a) => [a.id, draftFromAddon(a)])));
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAddons();
  }, [fetchAddons]);

  function updateDraft(id: number, patch: Partial<AddonDraft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function handleAddAddon(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    const price = Number(newPrice);
    const maxQuantity = Number(newMaxQuantity);
    if (!name || Number.isNaN(price) || price < 0) return;

    setAdding(true);
    setError(null);

    const { error: insertError } = await supabase.from('addons').insert({
      name,
      price,
      max_quantity: Number.isNaN(maxQuantity) || maxQuantity < 1 ? 1 : maxQuantity,
      active: true,
      sort_order: addons.length,
    });

    if (insertError) {
      setError(`Could not add add-on: ${insertError.message}`);
      setAdding(false);
      return;
    }

    setNewName('');
    setNewPrice('');
    setNewMaxQuantity('4');
    setAdding(false);
    await fetchAddons();
  }

  async function handleSaveAddon(addon: Addon) {
    const draft = drafts[addon.id];
    if (!draft) return;

    const name = draft.name.trim();
    const price = Number(draft.price);
    const maxQuantity = Number(draft.max_quantity);
    if (!name || Number.isNaN(price) || price < 0) {
      setError('Please enter a valid name and price.');
      return;
    }

    setSavingId(addon.id);
    setError(null);

    const { error: updateError } = await supabase
      .from('addons')
      .update({
        name,
        price,
        max_quantity: Number.isNaN(maxQuantity) || maxQuantity < 1 ? 1 : maxQuantity,
        active: draft.active,
      })
      .eq('id', addon.id);

    if (updateError) {
      setError(`Could not save add-on: ${updateError.message}`);
      setSavingId(null);
      return;
    }

    setSavingId(null);
    await fetchAddons();
  }

  async function handleDeleteAddon(addon: Addon) {
    if (!window.confirm(`Remove "${addon.name}"? Past bookings that included it keep their record.`)) {
      return;
    }

    setSavingId(addon.id);
    setError(null);

    const { error: deleteError } = await supabase.from('addons').delete().eq('id', addon.id);

    if (deleteError) {
      setError(`Could not remove add-on: ${deleteError.message}`);
      setSavingId(null);
      return;
    }

    setSavingId(null);
    await fetchAddons();
  }

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6 max-w-3xl">
      <h2 className="text-lg font-semibold text-slate-800 mb-1">Add-ons</h2>
      <p className="text-sm text-slate-500 mb-4">
        Rentable extras (paddles, balls, etc) customers can add to their booking before
        submitting. Only active add-ons are shown to customers.
      </p>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-400 mb-4">Loading add-ons…</p>
      ) : (
        <div className="space-y-3 mb-5">
          {addons.length === 0 && (
            <p className="text-sm text-slate-400">No add-ons yet — add one below.</p>
          )}
          {addons.map((addon) => {
            const draft = drafts[addon.id] ?? draftFromAddon(addon);
            const isSaving = savingId === addon.id;
            return (
              <div key={addon.id} className="rounded-xl border border-slate-200 p-3">
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-center">
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => updateDraft(addon.id, { name: e.target.value })}
                    disabled={isSaving}
                    placeholder="Paddle rental"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-slate-400">₱</span>
                    <input
                      type="number"
                      min={0}
                      value={draft.price}
                      onChange={(e) => updateDraft(addon.id, { price: e.target.value })}
                      disabled={isSaving}
                      className="w-24 rounded-lg border border-slate-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-slate-400 whitespace-nowrap">Max qty</span>
                    <input
                      type="number"
                      min={1}
                      value={draft.max_quantity}
                      onChange={(e) => updateDraft(addon.id, { max_quantity: e.target.value })}
                      disabled={isSaving}
                      className="w-16 rounded-lg border border-slate-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between mt-2.5">
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={draft.active}
                      onChange={(e) => updateDraft(addon.id, { active: e.target.checked })}
                      disabled={isSaving}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Active (shown to customers)
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSaveAddon(addon)}
                      disabled={isSaving}
                      className="rounded-lg bg-[var(--admin-btn-bg)] text-[var(--admin-btn-label)] text-xs font-medium px-3 py-1.5 hover:brightness-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => handleDeleteAddon(addon)}
                      disabled={isSaving}
                      className="rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs font-medium px-3 py-1.5 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <form onSubmit={handleAddAddon} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="e.g. Paddle rental"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-400">₱</span>
          <input
            type="number"
            min={0}
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            placeholder="150"
            className="w-24 rounded-lg border border-slate-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-400 whitespace-nowrap">Max qty</span>
          <input
            type="number"
            min={1}
            value={newMaxQuantity}
            onChange={(e) => setNewMaxQuantity(e.target.value)}
            className="w-16 rounded-lg border border-slate-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <button
          type="submit"
          disabled={adding || !newName.trim() || newPrice.trim() === ''}
          className="rounded-lg bg-[var(--admin-btn-bg)] text-[var(--admin-btn-label)] text-xs font-medium px-4 py-2 hover:brightness-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {adding ? 'Adding…' : 'Add'}
        </button>
      </form>

      {addons.length > 0 && (
        <p className="text-xs text-slate-400 mt-3">
          Example: {addons[0].name} — {formatPrice(addons[0].price)} each, up to{' '}
          {addons[0].max_quantity} per booking.
        </p>
      )}
    </section>
  );
}
