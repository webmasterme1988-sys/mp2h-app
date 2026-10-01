-- Run this once in the Supabase SQL editor (Project > SQL Editor) to wire
-- up the "Automatic Booking Cleanup" feature (Admin > Danger Zone).
--
-- Not applied automatically — schema.sql is a structure dump used for
-- provisioning brand new client instances (see scripts/new-client.mjs),
-- it does not get re-run against an already-live project. This file is the
-- one-time migration + cron setup for an EXISTING project that's adding
-- the feature after the fact (same "provided separately" pattern already
-- used for the booking-reminders pg_cron job).
--
-- Replace the one <...> placeholder below before running. The Cron Secret
-- itself is NOT pasted in here — the job looks it up live from
-- email_settings on every run (see step 2), so regenerating it later from
-- Admin > Branding & Settings doesn't require touching this SQL again.


-- 1. New site_settings columns (see lib/siteSettings.ts for the matching
--    TypeScript fields; this mirrors what's now in schema.sql so a fresh
--    project created via scripts/new-client.mjs already has these).

ALTER TABLE "public"."site_settings"
  ADD COLUMN IF NOT EXISTS "booking_cleanup_enabled" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "booking_cleanup_retention_days" integer DEFAULT 90 NOT NULL,
  ADD COLUMN IF NOT EXISTS "booking_cleanup_hour" integer DEFAULT 3 NOT NULL,
  ADD COLUMN IF NOT EXISTS "booking_cleanup_last_run_date" date;

ALTER TABLE "public"."site_settings"
  ADD CONSTRAINT "site_settings_cleanup_retention_check" CHECK ("booking_cleanup_retention_days" > 0);

ALTER TABLE "public"."site_settings"
  ADD CONSTRAINT "site_settings_cleanup_hour_check" CHECK ("booking_cleanup_hour" >= 0 AND "booking_cleanup_hour" < 24);


-- 2. Hourly pg_cron job that pings the cleanup route. The route itself
--    no-ops unless booking_cleanup_enabled is on AND the current
--    Philippine-time hour matches the admin's configured
--    booking_cleanup_hour AND it hasn't already run today — so this job
--    can stay scheduled hourly forever; the actual "when it runs" is
--    controlled from Admin > Danger Zone, not by editing this SQL again.
--
--    Site URL is already filled in below (https://mp2h-app.vercel.app).
--
--    A Cron Secret must already be set in Admin > Branding & Settings >
--    Email Notifications (click Generate, then Save) before this job can
--    authenticate — the value itself doesn't go in this file.

SELECT cron.schedule(
  'cleanup-old-bookings',
  '0 * * * *', -- every hour, on the hour
  $$
  SELECT net.http_post(
    url := 'https://mp2h-app.vercel.app/api/cron/cleanup-bookings',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT cron_secret FROM public.email_settings WHERE id = 1)
    )
  );
  $$
);

-- To change the site URL later, unschedule and re-run:
--   SELECT cron.unschedule('cleanup-old-bookings');
