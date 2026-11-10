const timeFmt = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long" });
const dayYearFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric" });
const weekdayFmt = new Intl.DateTimeFormat("tr-TR", { weekday: "short" });
const shortFmt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "2-digit" });

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const daysAgo = (d: Date) => Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);

export const clock = (iso: string) => timeFmt.format(new Date(iso));

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const ago = daysAgo(d);
  if (ago <= 0) return "Bugün";
  if (ago === 1) return "Dün";
  return d.getFullYear() === new Date().getFullYear() ? dayFmt.format(d) : dayYearFmt.format(d);
}

export function listTime(iso: string): string {
  const d = new Date(iso);
  const ago = daysAgo(d);
  if (ago <= 0) return timeFmt.format(d);
  if (ago === 1) return "Dün";
  if (ago < 7) return weekdayFmt.format(d);
  return shortFmt.format(d);
}

export function lastSeen(iso: string): string {
  const d = new Date(iso);
  if (Date.now() - d.getTime() < 90_000) return "az önce";
  const ago = daysAgo(d);
  if (ago <= 0) return `bugün ${timeFmt.format(d)}`;
  if (ago === 1) return `dün ${timeFmt.format(d)}`;
  return dayLabel(iso);
}

export const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : "Bir şeyler ters gitti.");

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");
