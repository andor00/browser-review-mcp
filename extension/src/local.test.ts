import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalUrl } from './local.ts';

test('isLocalUrl: only http on localhost or 127.0.0.1, any port', () => {
  assert.equal(isLocalUrl('http://localhost:5173/cases/1'), true);
  assert.equal(isLocalUrl('http://localhost/'), true);
  assert.equal(isLocalUrl('http://127.0.0.1:3000/'), true);
  assert.equal(isLocalUrl('https://localhost:5173/'), false);
  assert.equal(isLocalUrl('http://example.com/'), false);
  assert.equal(isLocalUrl('http://localhost.example.com/'), false);
  assert.equal(isLocalUrl('brave://extensions/'), false);
  assert.equal(isLocalUrl('not a url'), false);
});
