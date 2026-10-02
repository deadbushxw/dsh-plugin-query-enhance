/**
 * Mechanism 1: the list projection, over both list actions.
 * @module dsh-plugin-query-enhance/test/project
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectListPayload, summarizeBundle, summarizePluginEntry } from '../lib/project.js';
import { bundleFixture, listPayload, pluginFixture, realisticPayload, realisticPluginPayload } from './helpers.mjs';

test('a bundle summary keeps the fields a decision uses and drops the rest', () => {
  const summary = summarizeBundle(
    bundleFixture({
      name: '@deepseek-ai/dsh-base',
      version: '0.1.2-alpha.1',
      description: 'A long description that nobody deciding whether to enable this needs to read.',
      rows: [{ rowId: 'timer', moduleName: '@deepseek-ai/cordis-plugin-timer' }],
    }),
  );

  assert.deepEqual(Object.keys(summary).sort(), [
    'enabled',
    'installed',
    'name',
    'optional',
    'removable',
    'rowCount',
    'version',
  ]);
  assert.equal(summary.name, '@deepseek-ai/dsh-base');
  assert.equal(summary.version, '0.1.2-alpha.1');
  assert.equal(summary.enabled, true);
  assert.equal(summary.installed, true);
  assert.equal(summary.optional, false);
  assert.equal(summary.removable, true);
  assert.equal(summary.rowCount, 1);
  assert.equal(summary.description, undefined);
  assert.equal(summary.rows, undefined);
});

test('a bundle summary reports how much it dropped instead of dropping it silently', () => {
  const summary = summarizeBundle(
    bundleFixture({
      name: '@deepseek-ai/dsh-web-app',
      rows: [
        { rowId: 'llm', moduleName: '@deepseek-ai/dsh-llm' },
        { rowId: 'session', moduleName: '@deepseek-ai/dsh-session' },
        { rowId: 'tools', moduleName: '@deepseek-ai/dsh-tools' },
      ],
      overrides: ['built-in-a', 'built-in-b'],
    }),
  );
  assert.equal(summary.rowCount, 3);
  assert.equal(summary.overrideCount, 2);
});

test('overrideCount is omitted when a bundle overrides nothing', () => {
  const summary = summarizeBundle(bundleFixture({ name: '@deepseek-ai/dsh-base', rows: [] }));
  assert.equal(Object.hasOwn(summary, 'overrideCount'), false);
});

test('an error collapses to the code that decides the next step', () => {
  const summary = summarizeBundle(
    bundleFixture({
      name: '@deepseek-ai/dsh-office-to-pdf',
      rows: [],
      error: { code: 'not-bundle', diagnostic: 'a paragraph a human reads', incompatible: [{ name: 'x', version: '1', runtimeVersion: '2', peers: {} }] },
    }),
  );
  assert.equal(summary.error, 'not-bundle');
});

test('readOnlyReason survives, because it explains why an action is unavailable', () => {
  const summary = summarizeBundle(bundleFixture({ name: '@deepseek-ai/dsh-base', rows: [], readOnlyReason: 'management-required' }));
  assert.equal(summary.readOnlyReason, 'management-required');
});

test('a plugin entry summary keeps what sets_plugin takes and drops the patch row id', () => {
  const summary = summarizePluginEntry(
    pluginFixture({ entryId: 'timer', moduleName: '@deepseek-ai/cordis-plugin-timer', patchId: 'timer' }),
  );
  assert.deepEqual(summary, {
    entryId: 'timer',
    moduleName: '@deepseek-ai/cordis-plugin-timer',
    enabled: true,
    fiberPhase: 'active',
  });
  assert.equal(summary.patchId, undefined);
});

test('a plugin entry summary keeps readOnlyReason when the entry has one', () => {
  const summary = summarizePluginEntry(
    pluginFixture({ entryId: 'plugin-manager', moduleName: '@deepseek-ai/dsh-plugin-manager', readOnlyReason: 'management-required' }),
  );
  assert.equal(summary.readOnlyReason, 'management-required');
});

test('display metadata is stripped at both levels', () => {
  const payload = listPayload([
    bundleFixture({ name: '@deepseek-ai/dsh-base', rows: [{ rowId: 'timer', moduleName: '@deepseek-ai/cordis-plugin-timer' }] }),
  ]);
  assert.ok(JSON.stringify(payload).includes('Display text'));

  const projected = projectListPayload(payload);
  assert.equal(Object.hasOwn(projected.entries[0], 'meta'), false);
  assert.equal(JSON.stringify(projected).includes('Display text'), false);
});

test('one function serves both list actions, chosen by entry shape', () => {
  const projected = projectListPayload(listPayload([bundleFixture({ name: '@deepseek-ai/dsh-base', rows: [] })]));
  assert.equal(projected.entries[0].rowCount, 0);

  const entries = projectListPayload(listPayload([pluginFixture({ entryId: 'timer', moduleName: '@deepseek-ai/cordis-plugin-timer' })]));
  assert.equal(entries.entries[0].entryId, 'timer');
  assert.equal(entries.entries[0].rowCount, undefined);
});

test('the envelope keeps the meaning the management tool gave it', () => {
  const payload = listPayload([bundleFixture({ name: '@deepseek-ai/dsh-base', rows: [] })], { total: 11, nextOffset: 7 });
  const projected = projectListPayload(payload);
  assert.equal(projected.total, 11);
  assert.equal(projected.nextOffset, 7);
  assert.equal(projected.entries.length, 1);
});

test('projecting an already-projected payload changes nothing', () => {
  const payload = realisticPayload({ bundleCount: 2, rowsEach: 5 });
  const once = projectListPayload(payload);
  const twice = projectListPayload(once);
  assert.deepEqual(twice, once);
});

test('an entry that still carries a rows array is summarized', () => {
  // The interceptor only ever sees a plugin_manager payload, and every bundle
  // entry there carries rows, so every one is summarized; a complete record
  // arrives only from plugin_query, under a different tool name.
  const payload = listPayload([
    {
      name: '@deepseek-ai/dsh-base',
      version: '0.1.2-alpha.1',
      description: 'a description the summary drops',
      enabled: true,
      installed: true,
      optional: false,
      removable: true,
      rows: [{ rowId: 'timer', moduleName: '@deepseek-ai/cordis-plugin-timer' }],
    },
  ]);
  const projected = projectListPayload(payload);
  assert.equal(projected.entries[0].description, undefined);
  assert.equal(projected.entries[0].rowCount, 1);
  assert.equal(projected.entries[0].rows, undefined);
});

test('an entry shaped like neither list passes through untouched', () => {
  const payload = listPayload([{ something: 'else' }]);
  assert.deepEqual(projectListPayload(payload).entries[0], { something: 'else' });
});

test('a payload this version does not recognize is returned unchanged', () => {
  for (const candidate of [null, 42, 'text', [], {}, { entries: 'not an array' }]) {
    assert.deepEqual(projectListPayload(candidate), candidate);
  }
});

test('the projection removes the bulk of a realistic bundle payload', () => {
  const payload = realisticPayload({ bundleCount: 2, rowsEach: 60 });
  const before = JSON.stringify(payload).length;
  const after = JSON.stringify(projectListPayload(payload)).length;
  assert.ok(after * 8 < before, 'expected at least an 8x reduction, got ' + before + ' -> ' + after);
});

test('the answer to "is this bundle enabled" stays cheap', () => {
  const payload = realisticPayload({ bundleCount: 2, rowsEach: 60 });
  const one = JSON.stringify(projectListPayload(listPayload([payload.entries[0]])));
  assert.ok(one.length < 300, 'one summary line plus envelope should stay under 300 bytes, got ' + one.length);
});

test('a page of plugin entries comes back smaller too', () => {
  const payload = realisticPluginPayload({ count: 25 });
  const before = JSON.stringify(payload).length;
  const after = JSON.stringify(projectListPayload(payload)).length;
  assert.ok(after < before, 'expected the plugin page to shrink, got ' + before + ' -> ' + after);
  assert.equal(projectListPayload(payload).entries[0].patchId, undefined);
});
