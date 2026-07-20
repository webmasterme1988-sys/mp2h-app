'use client';

import { useState } from 'react';

interface DateCalendarProps {
  selectedDate: string; // 'YYYY-MM-DD'
  minDate: string; // 'YYYY-MM-DD'
  onSelect: (date: string) => void;
}

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toISODate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseISODate(iso: string) {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month: month - 1, day };
}

export default function DateCalendar({ selectedDate, minDate, onSelect }: DateCalendarProps) {
  const initial = parseISODate(selectedDate);
  const [viewYear, setViewYear] = useState(initial.year);
  const [viewMonth, setViewMonth] = useState(initial.month);

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  function goToPrevMonth() {
    setViewMonth((m) => {
      if (m === 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  }

  function goToNextMonth() {
    setViewMonth((m) => {
      if (m === 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  }

  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="rounded-xl border border-slate-300 p-3">
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={goToPrevMonth}
          aria-label="Previous month"
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          ‹
        </button>
        <span className="text-sm font-medium text-slate-700">
          {MONTH_LABELS[viewMonth]} {viewYear}
        </span>
        <button
          type="button"
          onClick={goToNextMonth}
          aria-label="Next month"
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-400 mb-1">
        {WEEKDAY_LABELS.map((label, i) => (
          <span key={i}>{label}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) return <span key={`empty-${i}`} />;

          const iso = toISODate(viewYear, viewMonth, day);
          const isSelected = iso === selectedDate;
          const isDisabled = iso < minDate;

          return (
            <button
              key={iso}
              type="button"
              disabled={isDisabled}
              onClick={() => onSelect(iso)}
              className={`aspect-square rounded-lg text-sm transition-colors ${
                isSelected
                  ? 'bg-emerald-600 text-white font-semibold'
                  : isDisabled
                  ? 'text-slate-300 cursor-not-allowed'
                  : 'text-slate-700 hover:bg-emerald-50'
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
