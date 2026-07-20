export interface TimeSlot {
  hour: number; // 24h start hour, e.g. 6 = 6:00 AM
  label: string; // "6:00 AM - 7:00 AM"
  startISO: (date: string) => string;
  endISO: (date: string) => string;
}

// Shared between the public booking page and the admin dashboard so a
// blocked slot always lines up with an actual bookable slot.
export const START_HOUR = 6; // 6:00 AM
export const END_HOUR = 22; // last slot START time is 9:00 PM, ending at 10:00 PM

export function formatHourLabel(hour: number) {
  const period = hour >= 12 ? 'PM' : 'AM';
  let displayHour = hour % 12;
  if (displayHour === 0) displayHour = 12;
  return `${displayHour}:00 ${period}`;
}

function buildTimeSlots(): TimeSlot[] {
  const slots: TimeSlot[] = [];
  for (let hour = START_HOUR; hour < END_HOUR; hour++) {
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

export const TIME_SLOTS = buildTimeSlots();

export function todayISODate() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60 * 1000);
  return local.toISOString().split('T')[0];
}
