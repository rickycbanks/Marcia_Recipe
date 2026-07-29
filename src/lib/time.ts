/** ISO-8601 week helpers (weeks start Monday). */

export const nowIso = (): string => new Date().toISOString();

/** ISO week id for a date, e.g. "2026-W30". */
export function isoWeekId(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // Monday = 1
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // Thursday of this week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** Shift a week id by `delta` weeks. */
export function shiftWeekId(weekId: string, delta: number): string {
  const monday = mondayOfWeek(weekId);
  monday.setUTCDate(monday.getUTCDate() + delta * 7);
  return isoWeekId(monday);
}

/** UTC Monday that starts the given ISO week. */
export function mondayOfWeek(weekId: string): Date {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekId);
  if (!match) throw new Error(`Invalid week id: ${weekId}`);
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayNum = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (dayNum - 1) + (week - 1) * 7);
  return monday;
}

/** Short human label for a week id, e.g. "Jul 27 – Aug 2, 2026". */
export function weekLabel(weekId: string): string {
  const monday = mondayOfWeek(weekId);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
  return `${fmt(monday, false)} – ${fmt(sunday, true)}`;
}
