// Mirrors the server's attachment limits and default extension list
// (apps/api/src/attachments/attachments.constants.ts). An operator can change them on the server;
// a file the server then refuses only costs a warning here.
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 128 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 20;
export const ALLOWED_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'mp4', 'webm', 'mov', 'txt', 'log', 'md', 'csv', 'json',
  'har', 'xml', 'html', 'htm', 'pdf', 'zip', 'gz', 'tgz', 'tar',
]);

const POLICIES = new Set(['failed', 'all', 'none']);

/** Reads TESTOPS_ATTACHMENTS: which results get artifacts. Empty means `failed`. */
export function parseAttachmentPolicy(value) {
  const policy = (value ?? '').trim().toLowerCase();
  if (!policy) return 'failed';
  if (!POLICIES.has(policy)) throw new Error('TESTOPS_ATTACHMENTS must be failed, all or none.');
  return policy;
}

/** Whether a result with this status gets its artifacts uploaded under the policy. */
export function shouldAttach(policy, status) {
  return policy === 'all' || (policy === 'failed' && status === 'FAILED');
}

/** Why the server would refuse this file, or null when it can be uploaded. */
export function skipReason({ name, size }) {
  if (size > MAX_FILE_BYTES) return `larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (!extension) return 'no extension';
  if (!ALLOWED_EXTENSIONS.has(extension)) return `file type .${extension} is not allowed`;
  return null;
}

/** Splits files, in order, into upload requests of at most 20 files and 128 MB. */
export function groupFiles(files) {
  const groups = [];
  let current = [];
  let bytes = 0;
  for (const file of files) {
    if (current.length >= MAX_FILES_PER_REQUEST || (current.length > 0 && bytes + file.size > MAX_REQUEST_BYTES)) {
      groups.push(current);
      current = [];
      bytes = 0;
    }
    current.push(file);
    bytes += file.size;
  }
  if (current.length) groups.push(current);
  return groups;
}
