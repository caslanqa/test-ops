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
