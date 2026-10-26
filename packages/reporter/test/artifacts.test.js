import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_REQUEST,
  MAX_REQUEST_BYTES,
  groupFiles,
  parseAttachmentPolicy,
  shouldAttach,
  skipReason,
} from '../artifacts.js';

test('parseAttachmentPolicy defaults to failed and rejects unknown values', () => {
  assert.equal(parseAttachmentPolicy(undefined), 'failed');
  assert.equal(parseAttachmentPolicy(''), 'failed');
  assert.equal(parseAttachmentPolicy(' ALL '), 'all');
  assert.equal(parseAttachmentPolicy('none'), 'none');
  assert.throws(() => parseAttachmentPolicy('sometimes'), /TESTOPS_ATTACHMENTS must be failed, all or none/);
});

test('shouldAttach follows the policy for PASSED and FAILED', () => {
  assert.equal(shouldAttach('failed', 'FAILED'), true);
  assert.equal(shouldAttach('failed', 'PASSED'), false);
  assert.equal(shouldAttach('all', 'PASSED'), true);
  assert.equal(shouldAttach('all', 'FAILED'), true);
  assert.equal(shouldAttach('none', 'FAILED'), false);
});

test('skipReason flags oversize, disallowed and extensionless files and accepts trace.zip', () => {
  assert.equal(skipReason({ name: 'trace.zip', size: 1024 }), null);
  assert.equal(skipReason({ name: 'TRACE.ZIP', size: MAX_FILE_BYTES }), null);
  assert.match(skipReason({ name: 'video.webm', size: MAX_FILE_BYTES + 1 }), /32 MB/);
  assert.match(skipReason({ name: 'run.exe', size: 10 }), /\.exe/);
  assert.match(skipReason({ name: 'README', size: 10 }), /no extension/);
});

test('groupFiles splits at 20 files', () => {
  const files = Array.from({ length: 25 }, (_, index) => ({ name: `f${index}.txt`, size: 1 }));
  const groups = groupFiles(files);
  assert.deepEqual(groups.map((group) => group.length), [MAX_FILES_PER_REQUEST, 5]);
  assert.deepEqual(groups.flat(), files);
});

test('groupFiles splits before a file that would pass 128 MB', () => {
  const big = MAX_REQUEST_BYTES / 2;
  const files = [{ size: big }, { size: big }, { size: 1 }];
  assert.deepEqual(groupFiles(files).map((group) => group.length), [2, 1]);
});
