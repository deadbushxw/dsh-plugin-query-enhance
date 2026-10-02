/**
 * Mechanism 2: the query engine.
 * @module dsh-plugin-query-enhance/test/filter
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeArguments } from '../lib/tool.js';
import { query } from '../lib/filter.js';
import { bundleFixture, pluginFixture } from './helpers.mjs';

/** Effective settings used throughout, unless a test overrides one. */
const settings = { defaultDetail: 'summary' };

const base = bundleFixture({
  name: '@deepseek-ai/dsh-base',
  version: '0.1.2-alpha.1',
  description: 'The shared core as a profile bundle.',
  rows: [
    { rowId: 'timer', moduleName: '@deepseek-ai/cordis-plugin-timer' },
    { rowId: 'hmr', moduleName: '@deepseek-ai/cordis-plugin-hmr' },
  ],
  installed: false,
  enabled: true,
});

const webApp = bundleFixture({
  name: '@deepseek-ai/dsh-web-app',
  version: '0.1.2-alpha.1',
  description: 'The Web application as a profile bundle.',
  rows: [{ rowId: 'web', moduleName: '@deepseek-ai/dsh-web-frontend', entryId: 'include:web' }],
  installed: true,
  enabled: true,
});

const voice = bundleFixture({
  name: '@deepseek-ai/dsh-experimental-voice-input-bundle',
  description: 'Voice input, shipped switched off.',
  rows: [],
  enabled: false,
  installed: false,
  optional: true,
});

const agentTeam = bundleFixture({
  name: '@deepseek-ai/dsh-experimental-agent-team-profile',
  description: 'The agent team profile.',
  rows: [],
  installed: true,
  enabled: false,
});

const office = bundleFixture({
  name: '@deepseek-ai/dsh-office-to-pdf',
  rows: [],
  enabled: true,
  installed: false,
  error: { code: 'not-bundle', diagnostic: 'an unreadable patch' },
});

const bundles = [base, webApp, voice, agentTeam, office];

const plugins = [
  pluginFixture({ entryId: 'timer', moduleName: '@deepseek-ai/cordis-plugin-timer', patchId: 'timer' }),
  pluginFixture({ entryId: 'hmr', moduleName: '@deepseek-ai/cordis-plugin-hmr', enabled: false, fiberPhase: null, patchId: 'hmr' }),
  pluginFixture({ entryId: 'plugin-manager', moduleName: '@deepseek-ai/dsh-plugin-manager', readOnlyReason: 'management-required' }),
];

/**
 * @param {object} raw raw arguments
 * @param {object[]} [rows] inventory to query
 * @param {'bundles'|'plugins'} [kind] which inventory is passed
 * @returns {object} the answer
 */
function run(raw, rows = bundles, kind = 'bundles') {
  const args = normalizeArguments({ kind, ...raw });
  return query({ kind: args.kind, rows, args, config: settings });
}

test('an exact name returns exactly that bundle', () => {
  const answer = run({ name: '@deepseek-ai/dsh-base' });
  assert.equal(answer.total, 5);
  assert.equal(answer.matched, 1);
  assert.equal(answer.entries[0].name, '@deepseek-ai/dsh-base');
  assert.equal(answer.entries[0].installed, false);
});

test('an exact name that matches nothing reports zero against the real total', () => {
  const answer = run({ name: '@deepseek-ai/dsh-no-such-bundle' });
  assert.deepEqual(answer.entries, []);
  assert.equal(answer.matched, 0);
  assert.equal(answer.total, 5);
  assert.equal(answer.nextOffset, null);
});

test('match reaches the module names a bundle declares', () => {
  const answer = run({ match: 'cordis-plugin-hmr' });
  assert.equal(answer.matched, 1);
  assert.equal(answer.entries[0].name, '@deepseek-ai/dsh-base');
});

test('match reaches the description', () => {
  const answer = run({ match: 'shared core' });
  assert.equal(answer.matched, 1);
  assert.equal(answer.entries[0].name, '@deepseek-ai/dsh-base');
});

test('match is case-insensitive', () => {
  assert.equal(run({ match: 'DSH-BASE' }).matched, run({ match: 'dsh-base' }).matched);
});

test('criteria combine with AND', () => {
  assert.equal(run({ installed: true, enabled: true }).matched, 1);
  assert.equal(run({ installed: false, enabled: true }).matched, 2);
  assert.equal(run({ installed: true, enabled: false }).matched, 1);
});

test('hasError selects on the presence of an error', () => {
  assert.equal(run({ hasError: true }).matched, 1);
  assert.equal(run({ hasError: false }).matched, 4);
});

test('optional selects the bundles shipped switched off', () => {
  const answer = run({ optional: true });
  assert.equal(answer.matched, 1);
  assert.equal(answer.entries[0].name, '@deepseek-ai/dsh-experimental-voice-input-bundle');
});

test('filters compose with match', () => {
  const answer = run({ match: 'experimental', installed: true });
  assert.equal(answer.matched, 1);
  assert.equal(answer.entries[0].name, '@deepseek-ai/dsh-experimental-agent-team-profile');
});

test('paging applies to the filtered set, not the inventory', () => {
  const first = run({ enabled: false, limit: 1 });
  assert.equal(first.matched, 2);
  assert.equal(first.entries.length, 1);
  assert.equal(first.nextOffset, 1);

  const second = run({ enabled: false, limit: 1, offset: first.nextOffset });
  assert.equal(second.entries.length, 1);
  assert.notEqual(second.entries[0].name, first.entries[0].name);
  assert.equal(second.nextOffset, null);
});

test('nextOffset is null once the filtered set is exhausted', () => {
  const answer = run({ limit: 100 });
  assert.equal(answer.entries.length, 5);
  assert.equal(answer.nextOffset, null);
});

test('a summary counts the declared rows it did not return', () => {
  const answer = run({ name: '@deepseek-ai/dsh-base' });
  assert.equal(answer.entries[0].rowCount, 2);
  assert.equal(answer.entries[0].rows, undefined);
});

test('includeRows adds the declared rows back to a summary', () => {
  const answer = run({ name: '@deepseek-ai/dsh-base', includeRows: true });
  assert.deepEqual(answer.entries[0].rows, [
    { rowId: 'timer', moduleName: '@deepseek-ai/cordis-plugin-timer' },
    { rowId: 'hmr', moduleName: '@deepseek-ai/cordis-plugin-hmr' },
  ]);
});

test('detail "full" returns the complete management record, still without display metadata', () => {
  const answer = run({ name: '@deepseek-ai/dsh-web-app', detail: 'full' });
  const record = answer.entries[0];
  assert.equal(record.description, 'The Web application as a profile bundle.');
  assert.deepEqual(record.rows, [
    { rowId: 'web', moduleName: '@deepseek-ai/dsh-web-frontend', entryId: 'include:web' },
  ]);
  assert.equal(Object.hasOwn(record, 'meta'), false);
});

test('detail "full" narrows the declared rows to the ones match hit', () => {
  const answer = run({ name: '@deepseek-ai/dsh-base', match: 'timer', detail: 'full' });
  assert.equal(answer.matched, 1);
  assert.deepEqual(answer.entries[0].rows, [{ rowId: 'timer', moduleName: '@deepseek-ai/cordis-plugin-timer' }]);
});

test('the settings default decides the detail level when the call omits one', () => {
  const args = normalizeArguments({ name: '@deepseek-ai/dsh-base' });
  const answer = query({ kind: 'bundles', rows: bundles, args, config: { defaultDetail: 'full' } });
  assert.equal(answer.entries[0].description, 'The shared core as a profile bundle.');
});

test('display metadata never reaches a query answer', () => {
  assert.equal(JSON.stringify(run({ limit: 100 })).includes('Display text'), false);
  assert.equal(JSON.stringify(run({ limit: 100 })).includes('"meta"'), false);
});

test('the plugins inventory filters on its own fields', () => {
  const answer = run({ match: 'cordis-plugin-hmr' }, plugins, 'plugins');
  assert.equal(answer.total, 3);
  assert.equal(answer.matched, 1);
  assert.equal(answer.entries[0].entryId, 'hmr');
  assert.equal(answer.entries[0].fiberPhase, null);
});

test('the plugins inventory answers an enabled-only question', () => {
  const answer = run({ enabled: false }, plugins, 'plugins');
  assert.equal(answer.matched, 1);
  assert.equal(answer.entries[0].entryId, 'hmr');
});

test('a plugin summary keeps the entry id and drops the patch row id', () => {
  const answer = run({ name: undefined, match: 'cordis-plugin-timer' }, plugins, 'plugins');
  const record = answer.entries[0];
  assert.deepEqual(Object.keys(record).sort(), ['enabled', 'entryId', 'fiberPhase', 'moduleName']);
  assert.equal(record.entryId, 'timer');
});

test('a plugin summary keeps readOnlyReason, which explains a refused action', () => {
  const answer = run({ match: 'plugin-manager' }, plugins, 'plugins');
  assert.equal(answer.entries[0].readOnlyReason, 'management-required');
});

test('detail "full" is the only way to obtain a complete plugin entry', () => {
  const answer = run({ match: 'cordis-plugin-timer', detail: 'full' }, plugins, 'plugins');
  assert.equal(answer.entries[0].patchId, 'timer');
  assert.equal(Object.hasOwn(answer.entries[0], 'meta'), false);
});

test('an empty inventory is an empty answer, not an error', () => {
  const answer = run({}, [], 'bundles');
  assert.deepEqual(answer.entries, []);
  assert.equal(answer.total, 0);
  assert.equal(answer.matched, 0);
});
