import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shape } from '../src/crawl.js';

test('shape collapses UUID and all-digit segments and joins with underscores', () => {
  assert.equal(shape('/cloud-foundry/5bf170ce-2f87-434f-b99f-4ceb0f18eb26/organizations'), 'cloud-foundry_id_organizations');
  assert.equal(shape('/applications/5bf170ce-2f87-434f-b99f-4ceb0f18eb26/e7842df2-71f7-44e6-9dd8-742151ad4527/ssh/0'), 'applications_id_id_ssh_id');
  assert.equal(shape('/home'), 'home');
  assert.equal(shape('/'), 'root');
  assert.equal(shape('/home/'), 'home');
});
