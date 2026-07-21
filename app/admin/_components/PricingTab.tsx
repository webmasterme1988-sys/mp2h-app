'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchSiteSettings, DEFAULT_SITE_SETTINGS, type SiteSettings } from '@/lib/siteSettings';
import { fetchPriceTiers, type PriceTier, type PricingMode } from '@/lib/priceTiers';
import { formatHourLabel } from '@/lib/timeSlots';
import { uploadBrandingImage } from '@/lib/brandingStorage';
import RichTextEditor from './RichTextEditor';

const HOUR_OPTIONS = Array.from({ length: 25 }, (_, i) => i);

export default function PricingTab() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);

  const [allowMultiSlot, setAllowMultiSlot] = useState(DEFAULT_SITE_SETTINGS.allow_multi_slot_booking);
  const [notifyOnApproval, setNotifyOnApproval] = useState(
    DEFAULT_SITE_SETTINGS.notify_customer_on_approval
  );
  const [showPrice, setShowPrice] = useState(DEFAULT_SITE_SETTINGS.show_price);
  const [pricingMode, setPricingMode] = useState<PricingMode>(DEFAULT_SITE_SETTINGS.pricing_mode);
  const [flatPrice, setFlatPrice] = useState(DEFAULT_SITE_SETTINGS.flat_price);

  const [attachMarketingImage, setAttachMarketingImage] = useState(
    DEFAULT_SITE_SETTINGS.attach_marketing_image
  );
  const [marketingImageFile, setMarketingImageFile] = useState<File | null>(null);
  const [marketingImagePreview, setMarketingImagePreview] = useState<string | null>(null);
  const [removeMarketingImage, setRemoveMarketingImage] = useState(false);
  const marketingImageInputRef = useRef<HTMLInputElement>(null);

  const [emailFooterHtml, setEmailFooterHtml] = useState(
    DEFAULT_SITE_SETTINGS.customer_email_footer_html ?? ''
  );
  const [attachReceiptToCustomerEmail, setAttachReceiptToCustomerEmail] = useState(
    DEFAULT_SITE_SETTINGS.attach_receipt_to_customer_email
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [tiers, setTiers] = useState<PriceTier[]>([]);
  const [tiersLoading, setTiersLoading] = useState(true);
  const [tiersError, setTiersError] = useState<string | null>(null);
  const [newTierStart, setNewTierStart] = useState(6);
  const [newTierEnd, setNewTierEnd] = useState(16);
  const [newTierPrice, setNewTierPrice] = useState(0);
  const [addingTier, setAddingTier] = useState(false);
  const [removingTierId, setRemovingTierId] = useState<number | null>(null);
  const [tierEdits, setTierEdits] = useState<
    Record<number, { start_hour: number; end_hour: number; price: number }>
  >({});
  const [savingTierId, setSavingTierId] = useState<number | null>(null);

  useEffect(() => {
    fetchSiteSettings(supabase).then((loaded) => {
      setSettings(loaded);
      setAllowMultiSlot(loaded.allow_multi_slot_booking);
      setNotifyOnApproval(loaded.notify_customer_on_approval);
      setShowPrice(loaded.show_price);
      setPricingMode(loaded.pricing_mode);
      setFlatPrice(loaded.flat_price);
      setAttachMarketingImage(loaded.attach_marketing_image);
      setEmailFooterHtml(loaded.customer_email_footer_html ?? '');
      setAttachReceiptToCustomerEmail(loaded.attach_receipt_to_customer_email);
      setLoading(false);
    });
  }, []);

  function handleMarketingImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setMarketingImageFile(file);
    setRemoveMarketingImage(false);
    setMarketingImagePreview(file ? URL.createObjectURL(file) : null);
  }

  const fetchTiers = useCallback(async () => {
    setTiersLoading(true);
    setTiersError(null);
    const list = await fetchPriceTiers(supabase);
    setTiers(list);
    setTiersLoading(false);
  }, []);

  useEffect(() => {
    fetchTiers();
  }, [fetchTiers]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (flatPrice < 0) {
      setError('Price cannot be negative.');
      return;
    }

    setSaving(true);

    let marketingImageUrl = settings.marketing_image_url;
    try {
      if (removeMarketingImage) marketingImageUrl = null;
      if (marketingImageFile) marketingImageUrl = await uploadBrandingImage(marketingImageFile, 'marketing');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload marketing image.');
      setSaving(false);
      return;
    }

    const { error: upsertError } = await supabase.from('site_settings').upsert({
      id: 1,
      site_title: settings.site_title,
      site_subtitle: settings.site_subtitle,
      primary_color: settings.primary_color,
      submit_button_label: settings.submit_button_label,
      payment_note: settings.payment_note,
      opening_hour: settings.opening_hour,
      closing_hour: settings.closing_hour,
      open_days: settings.open_days,
      pending_hold_minutes: settings.pending_hold_minutes,
      allow_multi_slot_booking: allowMultiSlot,
      notify_customer_on_approval: notifyOnApproval,
      show_price: showPrice,
      pricing_mode: pricingMode,
      flat_price: flatPrice,
      attach_marketing_image: attachMarketingImage,
      marketing_image_url: marketingImageUrl,
      customer_email_footer_html: emailFooterHtml.trim() || null,
      attach_receipt_to_customer_email: attachReceiptToCustomerEmail,
    });

    if (upsertError) {
      setError(upsertError.message);
      setSaving(false);
      return;
    }

    const refreshed = await fetchSiteSettings(supabase);
    setSettings(refreshed);
    setMarketingImageFile(null);
    setMarketingImagePreview(null);
    setRemoveMarketingImage(false);
    if (marketingImageInputRef.current) marketingImageInputRef.current.value = '';
    setSaving(false);
    setSuccess(true);
  }

  async function handleAddTier(e: React.FormEvent) {
    e.preventDefault();
    setTiersError(null);

    if (newTierEnd <= newTierStart) {
      setTiersError('End time must be after start time.');
      return;
    }
    if (newTierPrice < 0) {
      setTiersError('Price cannot be negative.');
      return;
    }

    setAddingTier(true);

    const { error } = await supabase.from('price_tiers').insert({
      start_hour: newTierStart,
      end_hour: newTierEnd,
      price: newTierPrice,
    });

    if (error) {
      setTiersError(`Could not add tier: ${error.message}`);
      setAddingTier(false);
      return;
    }

    setNewTierPrice(0);
    setAddingTier(false);
    await fetchTiers();
  }

  async function handleRemoveTier(id: number) {
    setRemovingTierId(id);
    setTiersError(null);

    const { error } = await supabase.from('price_tiers').delete().eq('id', id);

    if (error) {
      setTiersError(`Could not remove tier: ${error.message}`);
      setRemovingTierId(null);
      return;
    }

    setRemovingTierId(null);
    await fetchTiers();
  }

  function updateTierDraft(tier: PriceTier, field: 'start_hour' | 'end_hour' | 'price', value: number) {
    setTierEdits((prev) => ({
      ...prev,
      [tier.id]: {
        start_hour: field === 'start_hour' ? value : (prev[tier.id]?.start_hour ?? tier.start_hour),
        end_hour: field === 'end_hour' ? value : (prev[tier.id]?.end_hour ?? tier.end_hour),
        price: field === 'price' ? value : (prev[tier.id]?.price ?? tier.price),
      },
    }));
  }

  async function handleUpdateTier(id: number) {
    const draft = tierEdits[id];
    if (!draft) return;

    setTiersError(null);

    if (draft.end_hour <= draft.start_hour) {
      setTiersError('End time must be after start time.');
      return;
    }
    if (draft.price < 0) {
      setTiersError('Price cannot be negative.');
      return;
    }

    setSavingTierId(id);

    const { error } = await supabase
      .from('price_tiers')
      .update({ start_hour: draft.start_hour, end_hour: draft.end_hour, price: draft.price })
      .eq('id', id);

    if (error) {
      setTiersError(`Could not update tier: ${error.message}`);
      setSavingTierId(null);
      return;
    }

    setTierEdits((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSavingTierId(null);
    await fetchTiers();
  }

  const currentMarketingImage =
    marketingImagePreview ?? (removeMarketingImage ? null : settings.marketing_image_url);

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6 max-w-2xl">
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Booking &amp; Pricing</h2>
        <p className="text-sm text-slate-500 mb-6">
          Controls how customers book and whether they see prices.
        </p>

        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <form onSubmit={handleSave} className="space-y-5">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={allowMultiSlot}
                onChange={(e) => setAllowMultiSlot(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>
                <span className="block text-sm font-medium text-slate-700">
                  Allow booking multiple time slots in one submission
                </span>
                <span className="block text-xs text-slate-500 mt-0.5">
                  Customers can select several slots on the same court/date and pay for all of
                  them at once, instead of booking one slot at a time.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={notifyOnApproval}
                onChange={(e) => setNotifyOnApproval(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>
                <span className="block text-sm font-medium text-slate-700">
                  Email customers when their booking is approved
                </span>
                <span className="block text-xs text-slate-500 mt-0.5">
                  Sends a confirmation email to the customer&apos;s address once you approve their
                  booking. Requires the Gmail settings to be configured.
                </span>
              </span>
            </label>

            {notifyOnApproval && (
              <div className="pl-7 space-y-3 border-l-2 border-slate-100">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={attachReceiptToCustomerEmail}
                    onChange={(e) => setAttachReceiptToCustomerEmail(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>
                    <span className="block text-sm font-medium text-slate-700">
                      Attach the payment receipt to the confirmation email
                    </span>
                    <span className="block text-xs text-slate-500 mt-0.5">
                      Sends the customer a copy of the receipt they uploaded, alongside the
                      booking confirmation.
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={attachMarketingImage}
                    onChange={(e) => setAttachMarketingImage(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>
                    <span className="block text-sm font-medium text-slate-700">
                      Attach a marketing image to the confirmation email
                    </span>
                    <span className="block text-xs text-slate-500 mt-0.5">
                      e.g. a promo flyer or upcoming event poster — attached to every booking
                      confirmation email sent to customers.
                    </span>
                  </span>
                </label>

                {attachMarketingImage && (
                  <div>
                    {currentMarketingImage && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={currentMarketingImage}
                        alt="Marketing image preview"
                        className="h-24 w-auto object-contain mb-2 rounded border border-slate-200 bg-slate-50 p-2"
                      />
                    )}
                    <input
                      ref={marketingImageInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleMarketingImageChange}
                      className="w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:text-emerald-700 file:px-4 file:py-2 file:text-sm file:font-medium hover:file:bg-emerald-100"
                    />
                    {currentMarketingImage && (
                      <button
                        type="button"
                        onClick={() => {
                          setRemoveMarketingImage(true);
                          setMarketingImageFile(null);
                          setMarketingImagePreview(null);
                          if (marketingImageInputRef.current) marketingImageInputRef.current.value = '';
                        }}
                        className="mt-2 text-xs text-red-600 hover:text-red-700 underline underline-offset-2"
                      >
                        Remove image
                      </button>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Email footer text
                  </label>
                  <p className="text-xs text-slate-500 mb-2">
                    Appended to the bottom of every customer confirmation email — e.g. contact
                    info, social links, or a cancellation policy.
                  </p>
                  <RichTextEditor
                    value={emailFooterHtml}
                    onChange={setEmailFooterHtml}
                    placeholder="e.g. Questions? Reply to this email or call 0917-123-4567."
                  />
                </div>
              </div>
            )}

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={showPrice}
                onChange={(e) => setShowPrice(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>
                <span className="block text-sm font-medium text-slate-700">
                  Show price to customers
                </span>
                <span className="block text-xs text-slate-500 mt-0.5">
                  Displays the price on each time slot and a total in the booking form.
                </span>
              </span>
            </label>

            {showPrice && (
              <div className="pl-7 space-y-4 border-l-2 border-slate-100">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">
                    Pricing mode
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPricingMode('flat')}
                      className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
                        pricingMode === 'flat'
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : 'bg-white border-slate-300 text-slate-600 hover:border-emerald-400'
                      }`}
                    >
                      Flat rate
                    </button>
                    <button
                      type="button"
                      onClick={() => setPricingMode('tiered')}
                      className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
                        pricingMode === 'tiered'
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : 'bg-white border-slate-300 text-slate-600 hover:border-emerald-400'
                      }`}
                    >
                      Time-based tiers
                    </button>
                  </div>
                </div>

                {pricingMode === 'flat' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">
                      Price per slot
                    </label>
                    <div className="flex items-center gap-2 max-w-[160px]">
                      <span className="text-slate-500 text-sm">₱</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={flatPrice}
                        onChange={(e) => setFlatPrice(Number(e.target.value))}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                )}

                {pricingMode === 'tiered' && (
                  <p className="text-xs text-slate-500">
                    Manage time-based price tiers below — each hour uses whichever tier covers
                    it.
                  </p>
                )}
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
            {success && <p className="text-sm text-emerald-600">Saved.</p>}

            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-emerald-600 text-white font-medium px-6 py-2.5 text-sm hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </form>
        )}
      </section>

      {showPrice && pricingMode === 'tiered' && (
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6 max-w-2xl">
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Price Tiers</h2>
          <p className="text-sm text-slate-500 mb-4">
            e.g. 6:00 AM–4:00 PM at ₱250, then 4:00 PM–10:00 PM at ₱350. Tiers should cover every
            bookable hour — any hour not covered by a tier shows as ₱0.
          </p>

          {tiersError && <p className="text-sm text-red-600 mb-3">{tiersError}</p>}

          {tiersLoading ? (
            <p className="text-sm text-slate-400 mb-4">Loading tiers…</p>
          ) : (
            <div className="space-y-2 mb-5">
              {tiers.length === 0 && (
                <p className="text-sm text-slate-400">No tiers added yet.</p>
              )}
              {tiers.map((tier) => {
                const draft = tierEdits[tier.id] ?? {
                  start_hour: tier.start_hour,
                  end_hour: tier.end_hour,
                  price: tier.price,
                };
                const isDirty =
                  draft.start_hour !== tier.start_hour ||
                  draft.end_hour !== tier.end_hour ||
                  draft.price !== tier.price;
                const isSaving = savingTierId === tier.id;

                return (
                  <div
                    key={tier.id}
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-3"
                  >
                    <select
                      value={draft.start_hour}
                      onChange={(e) => updateTierDraft(tier, 'start_hour', Number(e.target.value))}
                      disabled={isSaving}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      {HOUR_OPTIONS.map((h) => (
                        <option key={h} value={h}>
                          {formatHourLabel(h)}
                        </option>
                      ))}
                    </select>
                    <span className="text-slate-400 text-sm">–</span>
                    <select
                      value={draft.end_hour}
                      onChange={(e) => updateTierDraft(tier, 'end_hour', Number(e.target.value))}
                      disabled={isSaving}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      {HOUR_OPTIONS.map((h) => (
                        <option key={h} value={h}>
                          {formatHourLabel(h)}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-500 text-sm">₱</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={draft.price}
                        onChange={(e) => updateTierDraft(tier, 'price', Number(e.target.value))}
                        disabled={isSaving}
                        className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div className="flex-1" />
                    <button
                      onClick={() => handleUpdateTier(tier.id)}
                      disabled={!isDirty || isSaving}
                      className="rounded-lg bg-emerald-600 text-white text-xs font-medium px-3 py-1.5 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                    >
                      {isSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => handleRemoveTier(tier.id)}
                      disabled={removingTierId === tier.id || isSaving}
                      className="rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs font-medium px-3 py-1.5 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                    >
                      {removingTierId === tier.id ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <form onSubmit={handleAddTier} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">From</label>
                <select
                  value={newTierStart}
                  onChange={(e) => setNewTierStart(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {HOUR_OPTIONS.map((h) => (
                    <option key={h} value={h}>
                      {formatHourLabel(h)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">To</label>
                <select
                  value={newTierEnd}
                  onChange={(e) => setNewTierEnd(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {HOUR_OPTIONS.map((h) => (
                    <option key={h} value={h}>
                      {formatHourLabel(h)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Price</label>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500 text-sm">₱</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={newTierPrice}
                    onChange={(e) => setNewTierPrice(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={addingTier}
              className="rounded-lg bg-emerald-600 text-white text-sm font-medium px-4 py-2.5 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {addingTier ? 'Adding…' : 'Add Tier'}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
