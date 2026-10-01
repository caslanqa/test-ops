// FR-045 referans değerleri: dosya başına ~32 MB, istek başına toplam ~128 MB,
// istek başına en fazla ~20 dosya. Çalışma zamanı değerleri ConfigService'ten
// (ATTACHMENT_* env) okunur; bunlar env verilmediğindeki varsayılanlardır.
export const ATTACHMENT_DEFAULT_MAX_FILE_SIZE_BYTES = 32 * 1024 * 1024;
export const ATTACHMENT_DEFAULT_MAX_REQUEST_SIZE_BYTES = 128 * 1024 * 1024;
export const ATTACHMENT_DEFAULT_MAX_FILES_PER_REQUEST = 20;

/** Yüklemelerin son konuma taşınmadan önce yazıldığı, attachment volume'u içindeki dizin. */
export const ATTACHMENT_TMP_DIRNAME = ".tmp";

// Uzantı → sunulacak Content-Type. İstemcinin bildirdiği MIME tipine güvenilmez:
// CI araçları çoğu zaman application/octet-stream gönderir, kötü niyetli bir
// istemci ise .png için text/html bildirebilir. Tip bu yüzden sunucuda uzantıdan
// türetilir. SVG bilerek yok (betik içerebilir); ATTACHMENT_ALLOWED_EXTENSIONS ile
// eklenen ama burada olmayan uzantılar application/octet-stream olarak sunulur.
export const ATTACHMENT_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  txt: "text/plain",
  log: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  har: "application/json",
  xml: "application/xml",
  html: "text/html",
  htm: "text/html",
  pdf: "application/pdf",
  zip: "application/zip",
  gz: "application/gzip",
  tgz: "application/gzip",
  tar: "application/x-tar",
};

/** ATTACHMENT_ALLOWED_EXTENSIONS verilmediğinde kabul edilen uzantılar. */
export const ATTACHMENT_DEFAULT_ALLOWED_EXTENSIONS = Object.keys(
  ATTACHMENT_MIME_BY_EXTENSION,
);

/** Dosya adından küçük harfli uzantıyı döndürür ("trace.tar.gz" → "gz", uzantısız → ""). */
export function attachmentExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

/** Dosyanın sunulacağı Content-Type; bilinmeyen uzantılar indirilebilir ikili veri olarak sunulur. */
export function attachmentMimeType(fileName: string): string {
  return (
    ATTACHMENT_MIME_BY_EXTENSION[attachmentExtension(fileName)] ??
    "application/octet-stream"
  );
}

/**
 * Busboy, multipart `filename` parametresini varsayılan olarak latin1 olarak çözer
 * ve multer 2.x `defParamCharset` seçeneğini ona iletmez. Tarayıcılar ve curl ise
 * adı UTF-8 bayt olarak gönderdiği için "görüntü" → "gÃ¶rÃ¼ntÃ¼" olarak kaydedilir.
 * Ad latin1 baytlarına geri çevrilip geçerli UTF-8 olarak çözülebiliyorsa düzeltilir;
 * saf ASCII veya zaten doğru çözülmüş (ör. RFC 5987 `filename*`) adlara dokunulmaz.
 */
export function normalizeUploadedFileName(name: string): string {
  const hasLatin1High = /[\u0080-\u00ff]/.test(name);
  const hasBeyondLatin1 = /[^\u0000-\u00ff]/.test(name);
  if (!hasLatin1High || hasBeyondLatin1) return name;
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") ? name : decoded;
}
