import { resolveJwtSecret } from "./jwt-secret";
import {
  ATTACHMENT_DEFAULT_ALLOWED_EXTENSIONS,
  ATTACHMENT_DEFAULT_MAX_FILES_PER_REQUEST,
  ATTACHMENT_DEFAULT_MAX_FILE_SIZE_BYTES,
  ATTACHMENT_DEFAULT_MAX_REQUEST_SIZE_BYTES,
} from "../attachments/attachments.constants";

/** Virgülle ayrılmış uzantı listesini ("png, .JPG,log") normalize eder; boşsa undefined. */
function parseExtensionList(value: string | undefined): string[] | undefined {
  const list = (value ?? "")
    .split(",")
    .map((ext) => ext.trim().replace(/^\./, "").toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

/**
 * Sayısal env değerini okur. Compose, tanımsız değişkenleri boş string olarak
 * geçirdiği için boş değer de "verilmemiş" sayılır; sayı olmayan değer
 * sessizce NaN limitine dönüşmek yerine başlangıçta hata verir.
 */
function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} pozitif bir tam sayı olmalı (verilen: "${raw}")`);
  }
  return value;
}

export default () => ({
  port: parseInt(process.env.PORT ?? "3000", 10),
  jwt: {
    secret: resolveJwtSecret(),
    expiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  },
  attachments: {
    dir: process.env.ATTACHMENTS_DIR ?? "./data/attachments",
    maxFileSizeBytes: intFromEnv(
      "ATTACHMENT_MAX_FILE_SIZE_BYTES",
      ATTACHMENT_DEFAULT_MAX_FILE_SIZE_BYTES,
    ),
    maxRequestSizeBytes: intFromEnv(
      "ATTACHMENT_MAX_REQUEST_SIZE_BYTES",
      ATTACHMENT_DEFAULT_MAX_REQUEST_SIZE_BYTES,
    ),
    maxFilesPerRequest: intFromEnv(
      "ATTACHMENT_MAX_FILES_PER_REQUEST",
      ATTACHMENT_DEFAULT_MAX_FILES_PER_REQUEST,
    ),
    allowedExtensions:
      parseExtensionList(process.env.ATTACHMENT_ALLOWED_EXTENSIONS) ??
      ATTACHMENT_DEFAULT_ALLOWED_EXTENSIONS,
  },
});
