import { formatPrice } from './priceTiers';
import { normalizeRichText } from './richText';
import { escapeHtml, htmlToPlainText } from './customerEmailTemplate';

export interface ReminderEmailSlot {
  timeRange: string; // e.g. "4:00 PM to 5:00 PM"
  price: number | null;
}

export interface ReminderEmailAddon {
  name: string;
  price: number; // per-unit, snapshotted at booking time
  quantity: number;
}

export interface ReminderEmailParams {
  playerName: string;
  hoursBefore: number; // the admin-configured threshold that triggered this reminder
  confirmationNumber: string | null;
  courtName: string;
  dateLabel: string; // e.g. "Jul 22, 2026"
  slots: ReminderEmailSlot[];
  totalHours: number;
  addons: ReminderEmailAddon[];
  totalPrice: number | null; // null = don't show a total line at all; includes addons
  footerHtml: string | null; // admin-configured, from the WYSIWYG editor
  address: string | null;
  directionsUrl: string | null; // from lib/googleMaps's getDirectionsUrl
}

// "in 24 hours" / "in 1 hour" / "in 4 hours" — the cron job only ever fires
// this with whole-hour admin-configured thresholds, so no minutes handling.
function formatHoursBefore(hours: number): string {
  return `in ${hours} hour${hours === 1 ? '' : 's'}`;
}

export function buildCustomerReminderEmail(
  params: ReminderEmailParams
): { text: string; html: string } {
  const {
    playerName,
    hoursBefore,
    confirmationNumber,
    courtName,
    dateLabel,
    slots,
    totalHours,
    addons,
    totalPrice,
    address,
    directionsUrl,
  } = params;

  const footerHtml = params.footerHtml ? normalizeRichText(params.footerHtml) : null;
  const whenPhrase = formatHoursBefore(hoursBefore);

  // ---------- Plain text (fallback for clients that don't render HTML) ----------

  const textLines: (string | null)[] = [
    `Hi ${playerName},`,
    '',
    `Just a reminder — your booking starts ${whenPhrase}.`,
    confirmationNumber ? `Confirmation #: ${confirmationNumber}` : null,
    '',
    `Court: ${courtName}`,
    `Date: ${dateLabel} (Philippine time)`,
    ...slots.map(
      (s) => `  - ${s.timeRange}${s.price !== null ? ` (${formatPrice(s.price)})` : ''}`
    ),
    `Total Hours: ${totalHours}`,
    addons.length > 0 ? '' : null,
    addons.length > 0 ? 'Add-ons:' : null,
    ...addons.map((a) => `  - ${a.name} x${a.quantity} (${formatPrice(a.price * a.quantity)})`),
    totalPrice !== null ? '' : null,
    totalPrice !== null ? `Total: ${formatPrice(totalPrice)}` : null,
    directionsUrl ? '' : null,
    directionsUrl && address ? `Location: ${address}` : null,
    directionsUrl ? `Get Directions: ${directionsUrl}` : null,
  ];

  const footerText = footerHtml ? htmlToPlainText(footerHtml) : '';
  if (footerText) {
    textLines.push('', '—', footerText);
  }

  const text = textLines.filter((l): l is string => l !== null).join('\n');

  // ---------- HTML ----------

  const slotsHtml = slots
    .map(
      (s) =>
        `&nbsp;&nbsp;- ${escapeHtml(s.timeRange)}${
          s.price !== null ? ` (${formatPrice(s.price)})` : ''
        }<br>`
    )
    .join('');

  const addonsHtml = addons
    .map(
      (a) =>
        `&nbsp;&nbsp;- ${escapeHtml(a.name)} x${a.quantity} (${formatPrice(a.price * a.quantity)})<br>`
    )
    .join('');

  const html = `
<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1f2937; line-height: 1.6;">
  <p style="margin: 0 0 16px;">Hi <strong>${escapeHtml(playerName)}</strong>,</p>
  <p style="margin: 0 0 16px;">
    Just a reminder — your booking starts <strong>${escapeHtml(whenPhrase)}</strong>.${
      confirmationNumber ? `<br>Confirmation #: ${confirmationNumber}` : ''
    }
  </p>
  <p style="margin: 0 0 16px;">
    Court: ${escapeHtml(courtName)}<br>
    Date: ${escapeHtml(dateLabel)} (Philippine time)<br>
    ${slotsHtml}
    Total Hours: ${totalHours}
  </p>
  ${
    addonsHtml
      ? `<p style="margin: 0 0 16px;">
    Add-ons:<br>
    ${addonsHtml}
  </p>`
      : ''
  }
  ${totalPrice !== null ? `<p style="margin: 0 0 16px;">Total: ${formatPrice(totalPrice)}</p>` : ''}
  ${
    directionsUrl
      ? `<p style="margin: 0 0 16px;">
    ${address ? `${escapeHtml(address)}<br>` : ''}
    <a href="${escapeHtml(directionsUrl)}" style="color: #059669;">Get Directions</a>
  </p>`
      : ''
  }
  ${
    footerHtml
      ? `<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
  <div>${footerHtml}</div>`
      : ''
  }
</div>`.trim();

  return { text, html };
}
