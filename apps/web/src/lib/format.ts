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

/** ISO tarihini "Oct 2, 2026" biçiminde gösterir. */
export function formatDate(iso: string | null | undefined): string {
  return iso ? dateFormatter.format(new Date(iso)) : '—';
}

/** ISO tarihini "Oct 2, 02:05 PM" biçiminde gösterir (run adları gibi kısa bağlamlar için). */
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

/** Workspace adından API'nin kabul ettiği slug'ı (küçük harf, rakam, tire) üretir. */
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
 * Arama için büyük/küçük harf ve i/ı/İ farkını yok sayan biçim. `toLocaleLowerCase('tr-TR')`
 * İngilizce başlıkları bozar ("Invoice" → "ınvoice"), varsayılan `toLowerCase` ise Türkçe
 * "İ"yi "i̇" yapar; ikisini de aynı "i"ye indirger.
 */
export function foldForSearch(value: string): string {
  return value.toLowerCase().replace(/ı/g, 'i').normalize('NFD').replace(/\u0307/g, '');
}

/** "1 case" / "3 cases" gibi İngilizce sayı-isim uyumu. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
