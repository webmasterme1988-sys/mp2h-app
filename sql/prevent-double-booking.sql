-- Run this once in the Supabase SQL editor (Project > SQL Editor) to stop
-- the same court + time slot from being booked twice.
--
-- Not applied automatically — schema.sql is a structure dump used for
-- provisioning brand new client instances (see scripts/new-client.mjs),
-- it does not get re-run against an already-live project. This file is the
-- one-time migration for an EXISTING project.
--
-- Until now the "is this slot free?" check only ran in the browser, right
-- before inserting. Two submissions racing each other (a double tap, two
-- customers at once, or an admin confirming an expired pending booking
-- after someone else took the slot) could both pass that check and both
-- insert. This trigger repeats the same check inside the database, under a
-- per-slot lock, so the second one is rejected.
--
-- Same rule the app uses (lib/slotAvailability.ts): a slot is taken by a
-- 'confirmed' booking, or by a 'pending' one still inside its
-- pending_hold_minutes approval window. Expired pending and cancelled
-- bookings don't count, so that behavior is unchanged.


-- 1. (Optional) See existing double bookings before adding the guard.
--    Lists every court + start time that has more than one active booking.

SELECT c.name AS court, b.start_time AT TIME ZONE 'Asia/Manila' AS start_time_ph,
       count(*) AS bookings,
       string_agg(b.player_name || ' (' || b.status || ', txn ' || coalesce(b.transaction_id::text, '-') || ')', ', ') AS who
FROM public.bookings b
JOIN public.courts c ON c.id = b.court_id
WHERE b.status IN ('pending', 'confirmed')
GROUP BY c.name, b.start_time
HAVING count(*) > 1
ORDER BY b.start_time DESC;


-- 2. The guard itself.

CREATE OR REPLACE FUNCTION "public"."enforce_no_double_booking"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  hold_minutes integer;
begin
  if new.status is null or new.status not in ('pending', 'confirmed') or new.court_id is null then
    return new;
  end if;

  -- Serializes concurrent bookings for this exact court + slot, so the
  -- second one waits for the first to commit and then sees it below.
  perform pg_advisory_xact_lock(hashtextextended(new.court_id::text || '|' || new.start_time::text, 0));

  select pending_hold_minutes into hold_minutes from public.site_settings where id = 1;
  hold_minutes := coalesce(hold_minutes, 10);

  if exists (
    select 1 from public.bookings b
    where b.court_id = new.court_id
      and b.start_time = new.start_time
      and b.id <> new.id
      and (
        b.status = 'confirmed'
        or (b.status = 'pending' and b.created_at > now() - make_interval(mins => hold_minutes))
      )
  ) then
    raise exception 'Sorry, this time slot is no longer available. Please select another.';
  end if;

  return new;
end;
$$;

ALTER FUNCTION "public"."enforce_no_double_booking"() OWNER TO "postgres";

CREATE OR REPLACE TRIGGER "trg_enforce_no_double_booking"
  BEFORE INSERT OR UPDATE OF "court_id", "start_time", "status" ON "public"."bookings"
  FOR EACH ROW EXECUTE FUNCTION "public"."enforce_no_double_booking"();
