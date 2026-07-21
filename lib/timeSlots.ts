export interface TimeSlot {
  hour: number; // 24h start hour, e.g. 6 = 6:00 AM
  label: string; // "6:00 AM - 7:00 AM"
  startISO: (date: string) => string;
  endISO: (date: string) => string;
}

// Fallback used only if site_settings hasn't been configured (or fails to
// load) — matches the app's original hardcoded hours so nothing changes for
// sites that haven't set custom hours yet.
export const DEFAULT_OPENING_HOUR = 6; // 6:00 AM
export const DEFAULT_CLOSING_HOUR = 22; // last slot starts 9:00 PM, ends 10:00 PM

// Accepts 24 (not just 0-23) so a closing time or price-tier boundary of
// "end of day" can be represented and displayed as 12:00 AM (midnight)
// rather than wrapping around to noon.
export function formatHourLabel(hour: number) {
  const normalizedHour = hour % 24;
  const period = normalizedHour >= 12 ? 'PM' : 'AM';
  let displayHour = normalizedHour % 12;
  if (displayHour === 0) displayHour = 12;
  return `${displayHour}:00 ${period}`;
}

// Shared between the public booking page and the admin dashboard so a
// blocked slot always lines up with an actual bookable slot — both must
// build the list from the same configured opening/closing hour.
export function buildTimeSlots(
  openingHour: number = DEFAULT_OPENING_HOUR,
  closingHour: number = DEFAULT_CLOSING_HOUR
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  for (let hour = openingHour; hour < closingHour; hour++) {
    slots.push({
      hour,
      label: `${formatHourLabel(hour)} - ${formatHourLabel(hour + 1)}`,
      startISO: (date: string) =>
        new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`).toISOString(),
      endISO: (date: string) =>
        new Date(`${date}T${String(hour + 1).padStart(2, '0')}:00:00`).toISOString(),
    });
  }
  return slots;
}

export function todayISODate() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60 * 1000);
  return local.toISOString().split('T')[0];
}
