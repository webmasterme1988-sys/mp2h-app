import { formatPrice } from './priceTiers';
import { normalizeRichText } from './richText';
import { formatReferenceNumber } from './confirmationCode';

export interface CustomerEmailSlot {
  timeRange: string; // e.g. "4:00 PM to 5:00 PM"
  price: number | null;
}

export interface CustomerEmailAddon {
  name: string;
  price: number; // per-unit, snapshotted at booking time
  quantity: number;
}

export interface CustomerEmailParams {
  playerName: string;
  playerPhone: string;
  transactionId: number | null;
  confirmationNumber: string | null; // transactions.confirmation_number
  courtName: string;
  dateLabel: string; // e.g. "Jul 22, 2026"
  slots: CustomerEmailSlot[];
  totalHours: number;
  // Add-ons belong to the whole transaction, not a single slot — shown for
  // context on every confirmation email for that transaction (one may be
  // sent per slot, see confirm-notify), but deliberately left out of
  // totalPrice below so a multi-slot booking doesn't double-count them
  // across its several per-slot emails.
  addons: CustomerEmailAddon[];
  totalPrice: number | null; // null = don't show a total line at all
  footerHtml: string | null; // admin-configured, from the WYSIWYG editor
  address: string | null;
  directionsUrl: string | null; // from lib/googleMaps's getDirectionsUrl
}

export function escapeHtml(str: string) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Rough HTML → plain-text conversion for the footer, since the WYSIWYG
// editor only ever produces a small, known set of tags (paragraphs, line
// breaks, bold/italic/underline, lists, links).
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildCustomerConfirmationEmail(
  params: CustomerEmailParams
): { text: string; html: string } {
  const {
    playerName,
    playerPhone,
    transactionId,
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

  // Guards against contentEditable's empty-but-truthy artifacts (e.g. a
  // bare "<br>" left behind after an admin deletes all the visible text),
  // which would otherwise still print an empty footer/divider.
  const footerHtml = params.footerHtml ? normalizeRichText(params.footerHtml) : null;

  const referenceNumber = transactionId !== null ? formatReferenceNumber(transactionId) : null;

  // ---------- Plain text (fallback for clients that don't render HTML) ----------

  const textLines: (string | null)[] = [
    `Hi ${playerName},`,
    '',
    'Your booking is confirmed!',
    confirmationNumber ? `Confirmation #: ${confirmationNumber}` : null,
    referenceNumber ? `Reference #: ${referenceNumber}` : null,
    '',
    `Contact Number: ${playerPhone}`,
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
    Your booking is confirmed!${
      confirmationNumber ? `<br><strong>Confirmation #: ${confirmationNumber}</strong>` : ''
    }${referenceNumber ? `<br><strong>Reference #: ${referenceNumber}</strong>` : ''}
  </p>
  <p style="margin: 0 0 16px;"><strong>Contact Number: ${escapeHtml(playerPhone)}</strong></p>
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
