/**
 * Mechanism 2: the tool definition and its argument contract.
 * @module dsh-plugin-query-enhance/test/tool
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TOOL_DESCRIPTION, TOOL_NAME, TOOL_PARAMETERS, createQueryTool, normalizeArguments } from '../lib/tool.js';
import { bundleFixture, pluginFixture } from './helpers.mjs';
import { checkSchemaSubset } from './schema-subset.mjs';

const settings = { defaultDetail: 'summary' };

const inventory = [
  bundleFixture({ name: '@deepseek-ai/dsh-base', rows: [], enabled: true, installed: false }),
  bundleFixture({ name: '@deepseek-ai/dsh-web-app', rows: [], enabled: true, installed: true }),
];

const pluginInventory = [pluginFixture({ entryId: 'timer', moduleName: '@deepseek-ai/cordis-plugin-timer' })];

/**
 * @param {object} raw settings overrides
 * @returns {object} a tool bound to the fixture inventories
 */
function toolWith(raw = {}) {
  return createQueryTool({
    readInventory: (kind) => (kind === 'bundles' ? inventory : pluginInventory),
    config: () => ({ ...settings, ...raw }),
  });
}

test('the tool name is the stable public identifier', () => {
  assert.equal(TOOL_NAME, 'plugin_query');
});

test('the parameter schema fits the subset the registry enforces', () => {
  assert.deepEqual(checkSchemaSubset(TOOL_PARAMETERS), []);
});

test('the output schema fits the subset the registry enforces', () => {
  assert.deepEqual(checkSchemaSubset({ type: 'string' }), []);
});

test('the parameter schema states every default in its own description', () => {
  for (const [name, property] of Object.entries(TOOL_PARAMETERS.properties)) {
    assert.equal(typeof property.description, 'string', name + ' needs a description');
    assert.ok(property.description.length > 10, name + ' needs a description that explains it');
  }
  assert.equal(TOOL_PARAMETERS.required, undefined, 'every parameter is optional');
});

test('the definition carries everything register() requires', () => {
  const tool = toolWith();
  assert.equal(typeof tool.name, 'string');
  assert.equal(typeof tool.description, 'string');
  assert.equal(tool.parameters.type, 'object');
  assert.equal(typeof tool.output.render, 'function');
  assert.equal(typeof tool.execute, 'function');
  assert.deepEqual(tool.output.render({}, 'payload'), [{ type: 'text', text: 'payload' }]);
  assert.equal(tool.isConcurrencySafe(), true);
});

test('the description says what it does and why to prefer it', () => {
  assert.ok(TOOL_DESCRIPTION.includes('plugin_manager'));
  assert.ok(TOOL_DESCRIPTION.includes('list_bundles'));
  assert.ok(TOOL_DESCRIPTION.includes('list_plugins'));
  assert.ok(TOOL_DESCRIPTION.length < 470, 'description length is a per-request cost: ' + TOOL_DESCRIPTION.length);
});

test('the defaults are bundles, ten per page, from the start', () => {
  const args = normalizeArguments({});
  assert.equal(args.kind, 'bundles');
  assert.equal(args.limit, 10);
  assert.equal(args.offset, 0);
  assert.equal(args.detail, undefined);
});

test('unknown keys are dropped rather than forwarded', () => {
  const args = normalizeArguments({ kind: 'bundles', nonsense: 'value', limit: 3 });
  assert.equal(Object.hasOwn(args, 'nonsense'), false);
  assert.equal(args.limit, 3);
});

test('a malformed kind is refused', () => {
  assert.throws(() => normalizeArguments({ kind: 'everything' }), /kind must be/);
});

test('a bundle-only filter is refused for plugins instead of being ignored', () => {
  for (const key of ['name', 'installed', 'optional', 'hasError', 'includeRows']) {
    assert.throws(() => normalizeArguments({ kind: 'plugins', [key]: true }), new RegExp('"' + key + '"'), key);
  }
});

test('an empty filter is refused, because it would match everything', () => {
  assert.throws(() => normalizeArguments({ name: '' }), /non-empty/);
  assert.throws(() => normalizeArguments({ match: '   ' }), /non-empty/);
});

test('a mistyped filter is refused', () => {
  assert.throws(() => normalizeArguments({ match: 7 }), /non-empty/);
  assert.throws(() => normalizeArguments({ enabled: 'yes' }), /must be a boolean/);
  assert.throws(() => normalizeArguments({ detail: 'everything' }), /detail must be/);
});

test('paging is bounded on both ends', () => {
  assert.throws(() => normalizeArguments({ limit: 0 }), /limit must be/);
  assert.throws(() => normalizeArguments({ limit: 101 }), /limit must be/);
  assert.throws(() => normalizeArguments({ limit: 2.5 }), /limit must be/);
  assert.throws(() => normalizeArguments({ offset: -1 }), /offset must be/);
  assert.throws(() => normalizeArguments({ offset: 1.5 }), /offset must be/);
});

test('executing returns the answer as a JSON string', async () => {
  const tool = toolWith();
  const payload = JSON.parse(await tool.execute({ name: '@deepseek-ai/dsh-base' }));
  assert.equal(payload.kind, 'bundles');
  assert.equal(payload.total, 2);
  assert.equal(payload.matched, 1);
  assert.equal(payload.entries[0].name, '@deepseek-ai/dsh-base');
  assert.equal(payload.nextOffset, null);
});

test('a query never returns display metadata', async () => {
  const tool = toolWith();
  const text = await tool.execute({ limit: 100 });
  assert.equal(text.includes('Display text'), false);
  assert.equal(text.includes('"meta"'), false);
});

test('the settings decide the detail level the call did not state', async () => {
  const tool = toolWith({ defaultDetail: 'full' });
  const payload = JSON.parse(await tool.execute({ name: '@deepseek-ai/dsh-base' }));
  assert.equal(Object.hasOwn(payload.entries[0], 'rows'), true);
});

test('a call that states its own detail wins over the setting', async () => {
  const tool = toolWith({ defaultDetail: 'full' });
  const payload = JSON.parse(await tool.execute({ name: '@deepseek-ai/dsh-base', detail: 'summary' }));
  assert.equal(Object.hasOwn(payload.entries[0], 'rows'), false);
  assert.equal(payload.entries[0].rowCount, 0);
});

test('the plugins inventory is served by the same tool', async () => {
  const tool = toolWith();
  const payload = JSON.parse(await tool.execute({ kind: 'plugins', match: 'cordis-plugin-timer' }));
  assert.equal(payload.kind, 'plugins');
  assert.equal(payload.matched, 1);
  assert.equal(payload.entries[0].entryId, 'timer');
});

test('the plugins inventory defaults to a summary too', async () => {
  const tool = toolWith();
  const payload = JSON.parse(await tool.execute({ kind: 'plugins' }));
  assert.deepEqual(Object.keys(payload.entries[0]).sort(), ['enabled', 'entryId', 'fiberPhase', 'moduleName']);
});

test('a failing inventory read surfaces as a failed call', async () => {
  const tool = createQueryTool({
    readInventory: () => {
      throw new Error('profile is unreadable');
    },
    config: () => settings,
  });
  await assert.rejects(() => tool.execute({}), /profile is unreadable/);
});
