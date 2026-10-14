const dateFormatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** Formats an ISO date as "Oct 2, 2026". */
export function formatDate(iso: string | null | undefined): string {
  return iso ? dateFormatter.format(new Date(iso)) : '—';
}

/** Formats an ISO date as "Oct 2, 02:05 PM" (for short contexts such as run names). */
export function formatDateTime(iso: string | Date): string {
  return dateTimeFormatter.format(typeof iso === 'string' ? new Date(iso) : iso);
}

const TURKISH_ASCII: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
};

/** Builds the slug the API accepts (lowercase letters, digits, hyphens) from a workspace name. */
export function slugify(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşü]/g, (ch) => TURKISH_ASCII[ch] ?? ch)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Search form that ignores case and the i/ı/İ distinction. `toLocaleLowerCase('tr-TR')`
 * breaks English titles ("Invoice" → "ınvoice"), while the default `toLowerCase` turns the
 * Turkish "İ" into "i̇"; this reduces both to the same "i".
 */
export function foldForSearch(value: string): string {
  return value.toLowerCase().replace(/ı/g, 'i').normalize('NFD').replace(/\u0307/g, '');
}

/** English number-noun agreement, such as "1 case" / "3 cases". */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** "2.4 MB" for file sizes. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** "1h 4m", "3m 7s", "42s" or "850ms" for a duration; the two largest units are enough to compare runs. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}

/** A timer reading such as "0:05:09"; used in the editable time spent field. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Reads a time typed by a tester: "1:05:09", "5:09" (minutes and seconds) or "45" (seconds).
 * Returns milliseconds, or null when the text isn't a time.
 */
export function parseClock(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const [s = 0, m = 0, h = 0] = parts.map(Number).reverse();
  if (parts.length > 1 && s >= 60) return null;
  if (parts.length > 2 && m >= 60) return null;
  return ((h * 60 + m) * 60 + s) * 1000;
}
