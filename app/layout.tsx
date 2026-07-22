import type { Metadata } from "next";
import { Geist, Geist_Mono, Anton } from "next/font/google";
import { createPublicServerClient } from "@/lib/supabase/publicServerClient";
import { fetchSiteSettings } from "@/lib/siteSettings";
import "./globals.css";

// The favicon needs to reflect the admin-uploaded logo (Branding &
// Settings), which can change at runtime — so it's fetched per-request
// here rather than a static file, matching the rest of the site's
// admin-editable content.
export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Bold condensed display font for the marketing landing page — matches the
// club's actual poster/brand kit (chunky, italicized sports-style
// headlines), used only for headings via the `font-display` utility.
const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-anton",
});

export async function generateMetadata(): Promise<Metadata> {
  const supabase = createPublicServerClient();
  const settings = await fetchSiteSettings(supabase);

  return {
    title: "MP2H Pickleball Booking System",
    description: "Powered by Good Steward",
    icons: settings.logo_url ? { icon: settings.logo_url } : undefined,
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${anton.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
