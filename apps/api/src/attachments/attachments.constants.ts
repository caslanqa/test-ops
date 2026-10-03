// FR-045 reference values: ~32 MB per file, ~128 MB total per request,
// at most ~20 files per request. Runtime values are read from ConfigService
// (ATTACHMENT_* env); these are the defaults when no env is given.
export const ATTACHMENT_DEFAULT_MAX_FILE_SIZE_BYTES = 32 * 1024 * 1024;
export const ATTACHMENT_DEFAULT_MAX_REQUEST_SIZE_BYTES = 128 * 1024 * 1024;
export const ATTACHMENT_DEFAULT_MAX_FILES_PER_REQUEST = 20;

/** Directory inside the attachment volume where uploads are written before being moved into place. */
export const ATTACHMENT_TMP_DIRNAME = ".tmp";

// Extension → Content-Type to serve. The client-declared MIME type is not trusted:
// CI tools often send application/octet-stream, while a malicious client may
// declare text/html for a .png. The type is therefore derived from the extension
// on the server. SVG is deliberately absent (it can contain script); extensions
// added via ATTACHMENT_ALLOWED_EXTENSIONS but missing here are served as application/octet-stream.
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

/** Extensions accepted when ATTACHMENT_ALLOWED_EXTENSIONS is not set. */
export const ATTACHMENT_DEFAULT_ALLOWED_EXTENSIONS = Object.keys(
  ATTACHMENT_MIME_BY_EXTENSION,
);

/** Returns the lowercase extension from a file name ("trace.tar.gz" → "gz", no extension → ""). */
export function attachmentExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

/** Content-Type to serve the file with; unknown extensions are served as downloadable binary data. */
export function attachmentMimeType(fileName: string): string {
  return (
    ATTACHMENT_MIME_BY_EXTENSION[attachmentExtension(fileName)] ??
    "application/octet-stream"
  );
}

/**
 * Busboy decodes the multipart `filename` parameter as latin1 by default, and
 * multer 2.x does not pass its `defParamCharset` option through. Browsers and curl
 * send the name as UTF-8 bytes, so "résumé" gets stored as "rÃ©sumÃ©".
 * If the name can be turned back into latin1 bytes and decoded as valid UTF-8, it is
 * fixed; pure ASCII or already correctly decoded (e.g. RFC 5987 `filename*`) names are left alone.
 */
export function normalizeUploadedFileName(name: string): string {
  const hasLatin1High = /[\u0080-\u00ff]/.test(name);
  const hasBeyondLatin1 = /[^\u0000-\u00ff]/.test(name);
  if (!hasLatin1High || hasBeyondLatin1) return name;
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") ? name : decoded;
}
