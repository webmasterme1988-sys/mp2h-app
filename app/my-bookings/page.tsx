import { createPublicServerClient } from '@/lib/supabase/publicServerClient';
import { fetchSiteSettings } from '@/lib/siteSettings';
import MyBookingsClient from './MyBookingsClient';

// Branding (color) is admin-editable and must reflect changes on the very
// next page load, not just after a rebuild — so this page is rendered fresh
// per-request rather than statically generated at build time.
export const dynamic = 'force-dynamic';

export default async function MyBookingsPage() {
  const supabase = createPublicServerClient();
  const settings = await fetchSiteSettings(supabase);

  return <MyBookingsClient initialSettings={settings} />;
}
