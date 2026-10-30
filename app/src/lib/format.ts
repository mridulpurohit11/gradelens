const TZ = 'Asia/Kolkata';

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function fmtDate(v?: string | Date | null) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ });
}

export function fmtShortDate(v?: string | Date | null) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: TZ });
}

export function fmtDateTime(v?: string | Date | null) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ });
}

export function fmtMonthYear(v?: string | Date | null) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: TZ });
}

/** yyyy-mm-dd in India time, for <input type="date"> */
export function toDateInput(v?: string | Date | null) {
  if (!v) return '';
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(v));
  return p;
}

export function fmtNum(n?: number | null, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number.isInteger(n) ? n.toLocaleString('en-IN') : n.toLocaleString('en-IN', { maximumFractionDigits: digits });
}

export function fmtPct(n?: number | null, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtInr(n?: number | null) {
  if (n === null || n === undefined) return '—';
  return `₹${n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString('en-IN')}`;
}

export function fmtDuration(sec: number) {
  if (sec < 60) return `${Math.max(1, Math.round(sec))} sec`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function initials(name?: string | null) {
  if (!name) return '?';
  const parts = name
    .replace(/^(dr|prof|mr|mrs|ms)\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

export function plural(n: number, word: string, pluralWord = `${word}s`) {
  return `${n.toLocaleString('en-IN')} ${n === 1 ? word : pluralWord}`;
}
