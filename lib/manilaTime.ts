import 'server-only';

// Philippine time is a fixed UTC+8 offset (no DST), so these don't need a
// timezone database — just the Intl formatter to read the current moment
// in that zone. Shared by the booking-cleanup and monthly-report cron jobs.
export function manilaDateString(date: Date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); // 'YYYY-MM-DD'
}

export function manilaHour(date: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(date)
  );
}

export function manilaDayOfMonth(date: Date = new Date()): number {
  return Number(manilaDateString(date).split('-')[2]);
}

// The UTC instant corresponding to a given Philippine calendar date's
// midnight.
function manilaMidnightUtcMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day, 0, 0, 0) - 8 * 60 * 60 * 1000;
}

// The [startIso, endIso) range covering the full calendar month before the
// current one (Philippine time), e.g. run in October, this covers all of
// September — plus a human label and a 'YYYY-MM' key for dedup tracking.
export function previousManilaMonthRange(now: Date = new Date()): {
  startIso: string;
  endIso: string;
  monthKey: string;
  monthLabel: string;
} {
  const [y, m] = manilaDateString(now).split('-').map(Number);
  let prevYear = y;
  let prevMonth = m - 1;
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear = y - 1;
  }

  const startMs = manilaMidnightUtcMs(prevYear, prevMonth, 1);
  const endMs = manilaMidnightUtcMs(y, m, 1); // start of current month = end of previous, exclusive

  return {
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
    monthKey: `${prevYear}-${String(prevMonth).padStart(2, '0')}`,
    monthLabel: new Date(startMs).toLocaleDateString('en-US', {
      timeZone: 'Asia/Manila',
      month: 'long',
      year: 'numeric',
    }),
  };
}
