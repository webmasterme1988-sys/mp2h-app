import { createPublicServerClient } from '@/lib/supabase/publicServerClient';
import { fetchSiteSettings } from '@/lib/siteSettings';
import { fetchPaymentQrCodes } from '@/lib/paymentQrCodes';
import { fetchHolidays } from '@/lib/holidays';
import BookingPageClient from './BookingPageClient';

// Branding (color, logo, hours) is admin-editable and must reflect changes
// on the very next page load, not just after a rebuild — so this page is
// rendered fresh per-request rather than statically generated at build time.
export const dynamic = 'force-dynamic';

export default async function Home() {
  const supabase = createPublicServerClient();

  const [settings, qrCodes, holidays] = await Promise.all([
    fetchSiteSettings(supabase),
    fetchPaymentQrCodes(supabase),
    fetchHolidays(supabase),
  ]);

  return (
    <BookingPageClient
      initialSettings={settings}
      initialQrCodes={qrCodes}
      initialHolidays={holidays}
    />
  );
}
