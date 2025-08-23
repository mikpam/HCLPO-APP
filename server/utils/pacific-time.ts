/**
 * Pacific Time Utility Module
 * Ensures all timestamps in the system use Pacific Time (PT)
 * This is strictly enforced across server, database, and client
 */

// Set the default timezone for the Node.js process to Pacific Time
process.env.TZ = 'America/Los_Angeles';

/**
 * Get current time in Pacific Time
 * @returns Date object in Pacific Time
 */
export function getPacificNow(): Date {
  return new Date();
}

/**
 * Convert any date to Pacific Time ISO string
 * @param date - Optional date to convert, defaults to now
 * @returns ISO string in Pacific Time
 */
export function toPacificISO(date?: Date): string {
  const d = date || getPacificNow();
  // Format with Pacific timezone offset
  return d.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).replace(/(\d+)\/(\d+)\/(\d+),?\s*/, '$3-$1-$2T') + getPacificOffset();
}

/**
 * Get Pacific Time offset string (e.g., "-08:00" or "-07:00")
 */
function getPacificOffset(): string {
  const now = new Date();
  const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const ptDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const offset = (utcDate.getTime() - ptDate.getTime()) / (1000 * 60 * 60);
  const sign = offset >= 0 ? '-' : '+';
  const absOffset = Math.abs(offset);
  const hours = Math.floor(absOffset).toString().padStart(2, '0');
  const minutes = ((absOffset % 1) * 60).toString().padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

/**
 * Format a date for display in Pacific Time
 * @param date - Date to format
 * @param includeTime - Whether to include time in the output
 * @returns Formatted string in Pacific Time
 */
export function formatPacificDate(date: Date | string, includeTime = true): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  
  if (includeTime) {
    return d.toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }) + ' PT';
  }
  
  return d.toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

/**
 * Get Unix timestamp (milliseconds) for current Pacific Time
 */
export function getPacificTimestamp(): number {
  return getPacificNow().getTime();
}

/**
 * Convert Unix timestamp to Pacific Time Date
 */
export function fromTimestamp(timestamp: number): Date {
  return new Date(timestamp);
}

/**
 * Check if a date is in Pacific Daylight Time (PDT) or Pacific Standard Time (PST)
 */
export function isPDT(date?: Date): boolean {
  const d = date || getPacificNow();
  const jan = new Date(d.getFullYear(), 0, 1);
  const jul = new Date(d.getFullYear(), 6, 1);
  const janOffset = jan.getTimezoneOffset();
  const julOffset = jul.getTimezoneOffset();
  const currentOffset = d.getTimezoneOffset();
  
  // If July offset is less than January offset, we're in a DST-observing timezone
  // If current offset matches July offset, we're in DST
  return julOffset < janOffset && currentOffset === julOffset;
}

/**
 * Get timezone abbreviation (PST or PDT)
 */
export function getTimezoneAbbr(date?: Date): string {
  return isPDT(date) ? 'PDT' : 'PST';
}

// Log timezone enforcement on module load
console.log(`⏰ TIMEZONE ENFORCED: Pacific Time (${getTimezoneAbbr()}) - All timestamps will use America/Los_Angeles`);