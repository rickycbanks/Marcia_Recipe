/**
 * Cook/prep duration formatting. Durations are stored as whole minutes
 * (recipe.prepMinutes / recipe.cookMinutes); these helpers turn them into
 * hour-aware strings for display. Pure functions.
 */

/**
 * Format a minute count as hours and minutes.
 *
 * Examples:
 *   90  → "1 hour 30 minutes"
 *   60  → "1 hour"
 *   45  → "45 minutes"
 *   150 → "2 hours 30 minutes"
 *   0   → "0 minutes"
 */
export function formatMinutesDuration(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes)) return String(totalMinutes);

  const sign = totalMinutes < 0 ? "-" : "";
  const abs = Math.abs(Math.round(totalMinutes));
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;

  const hourPart =
    hours > 0 ? `${hours} ${hours === 1 ? "hour" : "hours"}` : "";
  const minutePart =
    minutes > 0 || hours === 0 ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}` : "";

  if (hourPart && minutePart) return `${sign}${hourPart} ${minutePart}`;
  return `${sign}${hourPart || minutePart}`;
}

/**
 * Combine hour/minute input strings into total minutes.
 * Both blank → null; a blank half counts as 0.
 */
export function combineHoursMinutes(hours: string, minutes: string): number | null {
  const hoursValue = parseNonNegative(hours);
  const minutesValue = parseNonNegative(minutes);
  if (hoursValue === null && minutesValue === null) return null;
  return (hoursValue ?? 0) * 60 + (minutesValue ?? 0);
}

/**
 * Split stored minutes into editor hour/minute input strings
 * (zero halves render as blank, "90" → { hours: "1", minutes: "30" }).
 */
export function splitToHoursMinutes(total: number | null): { hours: string; minutes: string } {
  if (total === null || !Number.isFinite(total)) return { hours: "", minutes: "" };
  const abs = Math.max(0, Math.round(total));
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return {
    hours: hours > 0 ? String(hours) : "",
    minutes: minutes > 0 ? String(minutes) : "",
  };
}

function parseNonNegative(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
