'use client';

import React from 'react';
import { Calendar, Clock, Copy, Sparkles } from 'lucide-react';
import type { OpeningHours, ShopFlashSaleConfig } from '@/types/qlaok';
import { useAppI18n } from '@/components/ui/AppI18nProvider';

export const TIME_OPTIONS_24H: string[] = [
  '00:00',
  '05:00',
  '05:30',
  '06:00',
  '06:30',
  '07:00',
  '07:30',
  '08:00',
  '08:30',
  '09:00',
  '09:30',
  '10:00',
  '10:30',
  '11:00',
  '11:30',
  '12:00',
  '12:30',
  '13:00',
  '13:30',
  '14:00',
  '14:30',
  '15:00',
  '15:30',
  '16:00',
  '16:30',
  '17:00',
  '17:30',
  '18:00',
  '18:30',
  '19:00',
  '19:30',
  '20:00',
  '20:30',
  '21:00',
  '21:30',
  '22:00',
  '22:30',
  '23:00',
  '23:30',
  '23:59',
];

export const DAYS_OF_WEEK_LIST: {
  key: keyof OpeningHours;
  label: string;
}[] = [
  { key: 'mon', label: 'Thứ 2' },
  { key: 'tue', label: 'Thứ 3' },
  { key: 'wed', label: 'Thứ 4' },
  { key: 'thu', label: 'Thứ 5' },
  { key: 'fri', label: 'Thứ 6' },
  { key: 'sat', label: 'Thứ 7' },
  { key: 'sun', label: 'Chủ Nhật' },
];

const EN_WEEKDAYS: Record<keyof OpeningHours, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

/**
 * Compact 24-hour time dropdown that never overflows card containers
 */
export function TimeSelect24h({
  value,
  onChange,
  label,
  className = '',
}: {
  value: string;
  onChange: (nextTime: string) => void;
  label?: string;
  className?: string;
}) {
  const normalized = value?.trim() || '08:00';
  const options = TIME_OPTIONS_24H.includes(normalized)
    ? TIME_OPTIONS_24H
    : [normalized, ...TIME_OPTIONS_24H];

  return (
    <div className={`min-w-0 flex-1 ${className}`}>
      {label && (
        <span className="block text-[10px] font-bold text-slate-500 mb-1">
          {label}
        </span>
      )}
      <div className="relative flex items-center">
        <Clock className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-emerald-600" />
        <select
          aria-label={label}
          value={normalized}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none rounded-xl border border-slate-200 bg-white pl-7 pr-6 py-1.5 text-xs font-extrabold text-slate-900 shadow-2xs focus:border-emerald-500 focus:outline-none cursor-pointer"
        >
          {options.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2 text-[10px] font-bold text-slate-400">
          ▾
        </span>
      </div>
    </div>
  );
}

/**
 * Shared 7-Day Weekly Opening Hours Editor with 1-Click Presets and Zero Overflow
 */
export function WeeklyOpeningHoursPicker({
  openingHours,
  onChange,
}: {
  openingHours: OpeningHours;
  onChange: (next: OpeningHours) => void;
}) {
  const { tx } = useAppI18n();
  const applyPresetToAllDays = (open: string, close: string) => {
    const updated = { ...openingHours };
    for (const d of DAYS_OF_WEEK_LIST) {
      updated[d.key] = { open, close, closed: false };
    }
    onChange(updated);
  };

  const copyMondayToAll = () => {
    const mon = openingHours.mon || {
      open: '08:00',
      close: '22:00',
      closed: false,
    };
    const updated = { ...openingHours };
    for (const d of DAYS_OF_WEEK_LIST) {
      updated[d.key] = { ...mon };
    }
    onChange(updated);
  };

  return (
    <div className="space-y-4">
      {/* Quick 1-Tap Presets Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200/80 bg-slate-50 p-3">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
          <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
          <span>{tx('Cả tuần', 'Whole week')}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={copyMondayToAll}
            title={tx('Áp dụng giờ thứ 2 cho cả tuần', 'Apply Monday’s hours to the whole week')}
            className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-extrabold text-emerald-800 hover:bg-emerald-100 transition"
          >
            <Copy className="h-3 w-3" />
            <span>{tx('Chép thứ 2', 'Copy Monday')}</span>
          </button>
          <button
            type="button"
            onClick={() => applyPresetToAllDays('07:00', '22:00')}
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-100 transition"
          >
            ☀️ 07:00 – 22:00
          </button>
          <button
            type="button"
            onClick={() => applyPresetToAllDays('08:00', '23:00')}
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-100 transition"
          >
            🌙 08:00 – 23:00
          </button>
          <button
            type="button"
            onClick={() => applyPresetToAllDays('00:00', '23:59')}
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-100 transition"
          >
            {tx('Mở 24/7', 'Open 24/7')}
          </button>
        </div>
      </div>

      {/* 7-Day Grid (Clean 3-col on desktop so inputs have plenty of breathing room) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {DAYS_OF_WEEK_LIST.map(({ key, label }) => {
          const sched = openingHours[key] || {
            open: '08:00',
            close: '22:00',
            closed: false,
          };
          const isOpen = !sched.closed;

          return (
            <div
              key={key}
              className={`rounded-2xl border p-3.5 transition-all ${
                isOpen
                  ? 'border-slate-200 bg-slate-50/70'
                  : 'border-slate-200/60 bg-slate-100/60 opacity-75'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <span className="text-xs font-extrabold text-slate-900">
                  {tx(label, EN_WEEKDAYS[key])}
                </span>

                <button
                  type="button"
                  role="switch"
                  aria-checked={isOpen}
                  aria-label={tx('Giờ mở cửa: {day}', 'Opening hours: {day}', { day: tx(label, EN_WEEKDAYS[key]) })}
                  onClick={() =>
                    onChange({
                      ...openingHours,
                      [key]: { ...sched, closed: isOpen },
                    })
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold transition ${
                    isOpen
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      isOpen ? 'bg-emerald-600' : 'bg-slate-400'
                    }`}
                  />
                  <span>{isOpen ? tx('Mở', 'Open') : tx('Nghỉ', 'Closed')}</span>
                </button>
              </div>

              {isOpen ? (
                <div className="flex items-center gap-2">
                  <TimeSelect24h
                    label={tx('Giờ mở', 'Opens')}
                    value={sched.open}
                    onChange={(nextOpen) =>
                      onChange({
                        ...openingHours,
                        [key]: { ...sched, open: nextOpen },
                      })
                    }
                  />
                  <span className="text-xs font-black text-slate-400 shrink-0">
                    →
                  </span>
                  <TimeSelect24h
                    label={tx('Giờ đóng', 'Closes')}
                    value={sched.close}
                    onChange={(nextClose) =>
                      onChange({
                        ...openingHours,
                        [key]: { ...sched, close: nextClose },
                      })
                    }
                  />
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 py-1.5 text-center text-[11px] font-semibold text-slate-500">
                  {tx('Nghỉ cả ngày', 'Closed all day')}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Shared Multi-Day + Time Slot Picker for Flash Sale & Promotional Campaigns
 */
export function FlashSaleSchedulePicker({
  flashSale,
  onChange,
}: {
  flashSale: ShopFlashSaleConfig;
  onChange: (next: ShopFlashSaleConfig) => void;
}) {
  const { tx } = useAppI18n();
  const todayIso = new Date().toISOString().slice(0, 10);
  const startDate = flashSale.startDate || todayIso;
  const endDate = flashSale.endDate || todayIso;
  const startTime = flashSale.startTime || '11:00';
  const endTime = flashSale.endTime || '22:00';

  const setDateRangeDays = (daysCount: number) => {
    const start = new Date();
    const end = new Date();
    end.setDate(start.getDate() + Math.max(0, daysCount - 1));
    onChange({
      ...flashSale,
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    });
  };

  const setTimeSlotPreset = (sTime: string, eTime: string) => {
    onChange({
      ...flashSale,
      startTime: sTime,
      endTime: eTime,
    });
  };

  // Calculate total days selected
  const diffDays = (() => {
    const s = new Date(startDate);
    const e = new Date(endDate);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return 1;
    return Math.max(
      1,
      Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1
    );
  })();

  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50/40 p-3.5 space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-extrabold text-slate-900">
          <Calendar className="h-4 w-4 text-rose-600" />
          <span>{tx('Lịch ưu đãi', 'Promotion schedule')}</span>
        </div>
        <span className="rounded-full bg-rose-600 px-2.5 py-0.5 text-[10px] font-black text-white">
          {tx('{count} ngày', diffDays === 1 ? '{count} day' : '{count} days', { count: diffDays })} ({startTime} – {endTime})
        </span>
      </div>

      {/* Quick Multi-Day Presets */}
      <div>
        <span className="block text-[11px] font-bold text-slate-600 mb-1.5">
          {tx('Thời hạn', 'Duration')}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: tx('Hôm nay', 'Today'), days: 1 },
            { label: tx('3 ngày', '3 days'), days: 3 },
            { label: tx('7 ngày', '7 days'), days: 7 },
            { label: tx('14 ngày', '14 days'), days: 14 },
            { label: tx('30 ngày', '30 days'), days: 30 },
          ].map((preset) => {
            const active = diffDays === preset.days;
            return (
              <button
                key={preset.days}
                type="button"
                onClick={() => setDateRangeDays(preset.days)}
                className={`rounded-xl px-2.5 py-1.5 text-[11px] font-extrabold transition ${
                  active
                    ? 'bg-rose-600 text-white shadow-2xs'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Start Date & End Date Inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">
            {tx('Từ ngày', 'Start date')}
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              const nextStart = e.target.value;
              onChange({
                ...flashSale,
                startDate: nextStart,
                endDate: endDate < nextStart ? nextStart : endDate,
              });
            }}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-900 focus:border-rose-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">
            {tx('Đến ngày', 'End date')}
          </label>
          <input
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) =>
              onChange({
                ...flashSale,
                startDate,
                endDate: e.target.value,
              })
            }
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-900 focus:border-rose-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Quick Daily Time Slot Presets + 24h Time Selectors */}
      <div className="pt-1 border-t border-rose-200/60 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <span className="text-[11px] font-bold text-slate-600">
            {tx('Giờ áp dụng', 'Daily hours')}
          </span>
          <div className="flex flex-wrap gap-1">
            {[
              { label: tx('Trưa', 'Lunch') + ' (11:00–14:00)', s: '11:00', e: '14:00' },
              { label: tx('Tối', 'Evening') + ' (17:00–21:00)', s: '17:00', e: '21:00' },
              { label: tx('Cả ngày', 'Daytime') + ' (08:00–22:00)', s: '08:00', e: '22:00' },
              { label: '24h (00:00–23:59)', s: '00:00', e: '23:59' },
            ].map((slot) => {
              const active = startTime === slot.s && endTime === slot.e;
              return (
                <button
                  key={slot.label}
                  type="button"
                  onClick={() => setTimeSlotPreset(slot.s, slot.e)}
                  className={`rounded-lg px-2 py-1 text-[10px] font-bold transition ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {slot.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <TimeSelect24h
            label={tx('Bắt đầu', 'Starts')}
            value={startTime}
            onChange={(nextStart) =>
              onChange({ ...flashSale, startTime: nextStart })
            }
          />
          <span className="pt-4 text-xs font-black text-slate-400">→</span>
          <TimeSelect24h
            label={tx('Kết thúc', 'Ends')}
            value={endTime}
            onChange={(nextEnd) =>
              onChange({ ...flashSale, endTime: nextEnd })
            }
          />
        </div>
      </div>
    </div>
  );
}
