import assert from 'node:assert/strict';
import test from 'node:test';
import { testops } from '../reporter.js';

const ID = '550e8400-e29b-41d4-a716-446655440000';

test('testops returns the case annotation and the CI selector tag', () => {
  assert.deepEqual(testops(ID), {
    tag: `@testops-${ID}`,
    annotation: [{ type: 'testops', description: ID }],
  });
});

test('testops adds the known-defect annotation when a defect title is given', () => {
  assert.deepEqual(testops(ID, 'Cart total is wrong').annotation, [
    { type: 'testops', description: ID },
    { type: 'testops-defect', description: 'Cart total is wrong' },
  ]);
});

test('testops without an ID returns no annotation, and an ID that is not a UUID throws', () => {
  assert.deepEqual(testops(undefined), { annotation: [] });
  assert.deepEqual(testops('  '), { annotation: [] });
  assert.throws(() => testops('not-a-uuid'), /UUID/);
});
