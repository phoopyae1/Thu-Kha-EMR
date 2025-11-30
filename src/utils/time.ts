import { BadRequestError } from './httpErrors.js';

const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

export function toDateOnly(dateStr: string): Date {
  if (typeof dateStr !== 'string') {
    throw new BadRequestError('Date must be a string in format YYYY-MM-DD');
  }

  const normalized = dateStr.trim();
  const match = DATE_ONLY_REGEX.exec(normalized);

  if (!match) {
    throw new BadRequestError('Date must be in format YYYY-MM-DD');
  }

  const [, yearStr, monthStr, dayStr] = match;
  const date = new Date(`${normalized}T00:00:00Z`);

  if (Number.isNaN(date.getTime())) {
    throw new BadRequestError('Invalid calendar date');
  }

  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new BadRequestError('Invalid calendar date');
  }

  return date;
}

export function toMinutes(hhmm: string): number {
  // Handle 12-hour format with AM/PM (e.g., "4:00 PM", "4:00PM", "4:00 pm")
  const normalized = hhmm.trim().toUpperCase();
  const hasAM = normalized.includes('AM');
  const hasPM = normalized.includes('PM');
  
  // Remove AM/PM from the string
  const timeStr = normalized.replace(/\s*(AM|PM)\s*/i, '');
  const [hoursStr, minutesStr] = timeStr.split(":");
  
  if (!hoursStr || !minutesStr) {
    throw new BadRequestError('Time must be in format HH:MM or H:MM AM/PM');
  }
  
  let hours = Number(hoursStr);
  const minutes = Number(minutesStr);
  
  if (isNaN(hours) || isNaN(minutes)) {
    throw new BadRequestError('Time must be in format HH:MM or H:MM AM/PM');
  }
  
  // Handle 12-hour format
  if (hasAM || hasPM) {
    if (hours < 1 || hours > 12) {
      throw new BadRequestError('Hours must be between 1 and 12 for 12-hour format');
    }
    if (hasAM) {
      // 12:00 AM = 0:00, 1:00 AM = 1:00, ..., 11:00 AM = 11:00
      if (hours === 12) {
        hours = 0;
      }
    } else if (hasPM) {
      // 12:00 PM = 12:00, 1:00 PM = 13:00, ..., 11:00 PM = 23:00
      if (hours !== 12) {
        hours += 12;
      }
    }
  }
  
  // Validate hours and minutes
  if (hours < 0 || hours > 23) {
    throw new BadRequestError('Hours must be between 0 and 23');
  }
  if (minutes < 0 || minutes > 59) {
    throw new BadRequestError('Minutes must be between 0 and 59');
  }
  
  return hours * 60 + minutes;
}

export function minutesToHHMM(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const paddedHours = String(hours).padStart(2, "0");
  const paddedMinutes = String(minutes).padStart(2, "0");

  return `${paddedHours}:${paddedMinutes}`;
}

export function dayOfWeekUTC(date: Date): number {
  return date.getUTCDay();
}

export function composeDateTime(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}
