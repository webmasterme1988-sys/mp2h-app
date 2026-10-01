-- Run this once in the Supabase SQL editor (Project > SQL Editor) to wire
-- up the "Monthly Booking Report" feature (Admin > Pricing, next to
-- Booking Reminders).
--
-- Not applied automatically — same "provided separately" pattern already
-- used for the booking-reminders and booking-cleanup pg_cron jobs. See
-- sql/booking-cleanup-setup.sql for the sibling setup.
--
-- Replace the one <...> placeholder below before running. The Cron Secret
-- itself is NOT pasted in here — the job looks it up live from
-- email_settings on every run (see step 2), so regenerating it later from
-- Admin > Branding & Settings doesn't require touching this SQL again.


-- 1. New site_settings columns (see lib/siteSettings.ts for the matching
--    TypeScript fields; this mirrors what's now in schema.sql so a fresh
--    project created via scripts/new-client.mjs already has these).

ALTER TABLE "public"."site_settings"
  ADD COLUMN IF NOT EXISTS "monthly_report_enabled" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "monthly_report_day" integer DEFAULT 1 NOT NULL,
  ADD COLUMN IF NOT EXISTS "monthly_report_hour" integer DEFAULT 6 NOT NULL,
  ADD COLUMN IF NOT EXISTS "monthly_report_last_run_month" text;

ALTER TABLE "public"."site_settings"
  ADD CONSTRAINT "site_settings_report_day_check" CHECK ("monthly_report_day" >= 1 AND "monthly_report_day" <= 28);

ALTER TABLE "public"."site_settings"
  ADD CONSTRAINT "site_settings_report_hour_check" CHECK ("monthly_report_hour" >= 0 AND "monthly_report_hour" < 24);


-- 2. Daily pg_cron job that pings the report route. The route itself
--    no-ops unless monthly_report_enabled is on AND today is the admin's
--    configured day-of-month AND the current Philippine-time hour matches
--    the configured hour AND it hasn't already sent this month's report —
--    so this job can stay scheduled daily forever; the actual "when it
--    sends" is controlled from Admin > Pricing, not by editing this SQL
--    again.
--
--    Site URL is already filled in below (https://mp2h-app.vercel.app).
--
--    A Cron Secret must already be set in Admin > Branding & Settings >
--    Email Notifications (click Generate, then Save) before this job can
--    authenticate — the value itself doesn't go in this file.

SELECT cron.schedule(
  'send-monthly-booking-report',
  '0 * * * *', -- every hour, on the hour (the route itself gates on day+hour)
  $$
  SELECT net.http_post(
    url := 'https://mp2h-app.vercel.app/api/cron/send-monthly-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT cron_secret FROM public.email_settings WHERE id = 1)
    )
  );
  $$
);

-- To change the site URL later, unschedule and re-run:
--   SELECT cron.unschedule('send-monthly-booking-report');
