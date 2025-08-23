/**
 * Pacific Time Utility for Client-Side
 * Ensures all timestamps are displayed in Pacific Time (PT)
 */

/**
 * Format a date/timestamp for display in Pacific Time
 * @param date - Date string or Date object to format
 * @param includeTime - Whether to include time in the output (default: true)
 * @param includeSeconds - Whether to include seconds (default: false)
 * @returns Formatted string in Pacific Time with PT/PDT indicator
 */
export function formatPacificTime(
  date: string | Date | null | undefined,
  includeTime = true,
  includeSeconds = false
): string {
  if (!date) return '';
  
  const d = typeof date === 'string' ? new Date(date) : date;
  
  // Check if date is valid
  if (isNaN(d.getTime())) return '';
  
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  };
  
  if (includeTime) {
    options.hour = '2-digit';
    options.minute = '2-digit';
    if (includeSeconds) {
      options.second = '2-digit';
    }
    options.hour12 = true;
  }
  
  const formatted = d.toLocaleString('en-US', options);
  
  // Determine if we're in PDT or PST
  const tzAbbr = isPDT(d) ? 'PDT' : 'PST';
  
  return includeTime ? `${formatted} ${tzAbbr}` : formatted;
}

/**
 * Format date for display in short format (MM/DD/YYYY)
 * @param date - Date string or Date object
 * @returns Formatted date string in Pacific Time
 */
export function formatPacificDateShort(date: string | Date | null | undefined): string {
  if (!date) return '';
  
  const d = typeof date === 'string' ? new Date(date) : date;
  
  if (isNaN(d.getTime())) return '';
  
  return d.toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric'
  });
}

/**
 * Format time only in Pacific Time
 * @param date - Date string or Date object
 * @param includeSeconds - Whether to include seconds
 * @returns Time string in Pacific Time with PT/PDT indicator
 */
export function formatPacificTimeOnly(
  date: string | Date | null | undefined,
  includeSeconds = false
): string {
  if (!date) return '';
  
  const d = typeof date === 'string' ? new Date(date) : date;
  
  if (isNaN(d.getTime())) return '';
  
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  };
  
  if (includeSeconds) {
    options.second = '2-digit';
  }
  
  const formatted = d.toLocaleTimeString('en-US', options);
  const tzAbbr = isPDT(d) ? 'PDT' : 'PST';
  
  return `${formatted} ${tzAbbr}`;
}

/**
 * Get relative time string (e.g., "2 hours ago") in Pacific Time context
 * @param date - Date string or Date object
 * @returns Relative time string
 */
export function getRelativeTime(date: string | Date | null | undefined): string {
  if (!date) return '';
  
  const d = typeof date === 'string' ? new Date(date) : date;
  
  if (isNaN(d.getTime())) return '';
  
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  
  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
  
  return formatPacificDateShort(d);
}

/**
 * Check if a date is in Pacific Daylight Time (PDT) or Pacific Standard Time (PST)
 * @param date - Date to check
 * @returns true if in PDT, false if in PST
 */
function isPDT(date: Date): boolean {
  // PDT runs from second Sunday in March to first Sunday in November
  const year = date.getFullYear();
  
  // Get second Sunday in March
  const marchFirst = new Date(year, 2, 1);
  const daysUntilSunday = (7 - marchFirst.getDay()) % 7;
  const firstSunday = new Date(year, 2, 1 + daysUntilSunday);
  const secondSunday = new Date(year, 2, firstSunday.getDate() + 7);
  
  // Get first Sunday in November
  const novemberFirst = new Date(year, 10, 1);
  const daysUntilNovSunday = (7 - novemberFirst.getDay()) % 7;
  const firstNovSunday = new Date(year, 10, 1 + daysUntilNovSunday);
  
  // Check if date is in PDT range
  return date >= secondSunday && date < firstNovSunday;
}

/**
 * Get current Pacific Time as a formatted string
 * @param includeTime - Whether to include time
 * @param includeSeconds - Whether to include seconds
 * @returns Current Pacific Time formatted
 */
export function getCurrentPacificTime(includeTime = true, includeSeconds = false): string {
  return formatPacificTime(new Date(), includeTime, includeSeconds);
}

// Log on module load in development
if (process.env.NODE_ENV === 'development') {
  console.log('🌎 Client timezone formatting: Pacific Time (PT) enforced for all displays');
}