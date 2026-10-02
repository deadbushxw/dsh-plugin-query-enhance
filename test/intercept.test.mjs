/**
 * Mechanism 1: the tools/post-execute listener, over both list actions.
 * @module dsh-plugin-query-enhance/test/intercept
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createListProjector } from '../lib/intercept.js';
import { realisticPayload, realisticPluginPayload, runWaterfall } from './helpers.mjs';

const settings = { intercept: true };

/**
 * @param {string} action the management action
 * @param {string} [name] the tool name
 * @returns {object} a minimal execution
 */
function execution(action, name = 'plugin_manager') {
  return { name, arguments: { action } };
}

/**
 * @param {unknown} value the dispatched value
 * @param {boolean} [isError] whether the call failed
 * @returns {object} a minimal dispatched result
 */
function dispatched(value, isError = false) {
  return { isError, value, content: [{ type: 'text', text: typeof value === 'string' ? value : '' }] };
}

const bundleText = JSON.stringify(realisticPayload({ bundleCount: 2, rowsEach: 40 }));
const pluginText = JSON.stringify(realisticPluginPayload({ count: 100 }));

test('an unrelated tool is delegated untouched', async () => {
  const listener = createListProjector({ config: () => settings });
  const result = dispatched('{"anything":true}');
  const decision = await runWaterfall([listener], execution('list_bundles', 'other_tool'), result);
  assert.deepEqual(decision, { kind: 'accept' });
});

test('an unrelated action is delegated untouched', async () => {
  const listener = createListProjector({ config: () => settings });
  const result = dispatched('{"entries":[],"total":0,"nextOffset":null}');
  const decision = await runWaterfall([listener], execution('install_bundle'), result);
  assert.deepEqual(decision, { kind: 'accept' });
});

test('a list_bundles payload comes back projected', async () => {
  const listener = createListProjector({ config: () => settings });
  const decision = await runWaterfall([listener], execution('list_bundles'), dispatched(bundleText));
  assert.equal(decision.kind, 'accept');
  assert.ok(decision.value.length * 8 < bundleText.length, 'expected a large reduction');
  const payload = JSON.parse(decision.value);
  assert.equal(payload.entries.length, 2);
  assert.equal(payload.entries[0].rowCount, 40);
  assert.equal(Object.hasOwn(payload.entries[0], 'rows'), false);
  assert.equal(Object.hasOwn(payload.entries[0], 'description'), false);
});

test('a list_plugins payload comes back projected too', async () => {
  const listener = createListProjector({ config: () => settings });
  const decision = await runWaterfall([listener], execution('list_plugins'), dispatched(pluginText));
  assert.equal(decision.kind, 'accept');
  assert.ok(decision.value.length < pluginText.length, 'expected the plugin page to shrink');
  const payload = JSON.parse(decision.value);
  assert.equal(payload.entries.length, 100);
  assert.equal(payload.entries[0].entryId, 'entry-0');
  assert.equal(Object.hasOwn(payload.entries[0], 'patchId'), false);
});

test('a listener registered after this one still runs for either action', async () => {
  const seen = [];
  const listener = createListProjector({ config: () => settings });
  const later = async (exec, result, next) => {
    seen.push(exec.arguments.action);
    return next();
  };
  await runWaterfall([listener, later], execution('list_bundles'), dispatched(bundleText));
  await runWaterfall([listener, later], execution('list_plugins'), dispatched(pluginText));
  assert.deepEqual(seen, ['list_bundles', 'list_plugins']);
});

test('a decision the rest of the chain replaced wins', async () => {
  const listener = createListProjector({ config: () => settings });
  const replacer = async () => ({ kind: 'accept', value: 'replaced by someone else' });
  const decision = await runWaterfall([listener, replacer], execution('list_plugins'), dispatched(pluginText));
  assert.equal(decision.value, 'replaced by someone else');
});

test('a content replacement is left alone', async () => {
  const listener = createListProjector({ config: () => settings });
  const replacer = async () => ({ kind: 'accept', content: [{ type: 'text', text: 'other content' }] });
  const decision = await runWaterfall([listener, replacer], execution('list_bundles'), dispatched(bundleText));
  assert.deepEqual(decision, { kind: 'accept', content: [{ type: 'text', text: 'other content' }] });
  assert.equal(Object.hasOwn(decision, 'value'), false);
});

test('a block downstream is preserved and never becomes a value', async () => {
  const listener = createListProjector({ config: () => settings });
  const blocker = async () => ({ kind: 'block', feedback: [{ type: 'text', text: 'denied' }] });
  const decision = await runWaterfall([listener, blocker], execution('list_bundles'), dispatched(bundleText));
  assert.equal(decision.kind, 'block');
  assert.equal(Object.hasOwn(decision, 'value'), false);
});

test('fields a downstream decision added survive the refinement', async () => {
  const listener = createListProjector({ config: () => settings });
  const annotator = async (exec, result, next) => ({ ...(await next()), additionalContexts: [{ note: true }] });
  const decision = await runWaterfall([listener, annotator], execution('list_plugins'), dispatched(pluginText));
  assert.deepEqual(decision.additionalContexts, [{ note: true }]);
  assert.ok(decision.value.length < pluginText.length);
});

test('a failed call keeps its own result', async () => {
  const listener = createListProjector({ config: () => settings });
  const decision = await runWaterfall([listener], execution('list_plugins'), dispatched(pluginText, true));
  assert.deepEqual(decision, { kind: 'accept' });
});

test('a payload this version cannot parse is passed through', async () => {
  const listener = createListProjector({ config: () => settings });
  for (const action of ['list_bundles', 'list_plugins']) {
    const decision = await runWaterfall([listener], execution(action), dispatched('not json'));
    assert.equal(Object.hasOwn(decision, 'value'), false, action);
  }
});

test('a value that is not a string is passed through', async () => {
  const listener = createListProjector({ config: () => settings });
  const decision = await runWaterfall([listener], execution('list_plugins'), dispatched({ already: 'an object' }));
  assert.equal(Object.hasOwn(decision, 'value'), false);
});

test('interception can be switched off without uninstalling', async () => {
  const listener = createListProjector({ config: () => ({ intercept: false }) });
  for (const [action, text] of [['list_bundles', bundleText], ['list_plugins', pluginText]]) {
    const decision = await runWaterfall([listener], execution(action), dispatched(text));
    assert.deepEqual(decision, { kind: 'accept' }, action);
  }
});

test('an already-projected payload is left as it is', async () => {
  const listener = createListProjector({ config: () => settings });
  const summary = JSON.stringify({ entries: [{ name: '@deepseek-ai/dsh-base', rowCount: 0 }], total: 1, nextOffset: null });
  const decision = await runWaterfall([listener], execution('list_bundles'), dispatched(summary));
  assert.equal(Object.hasOwn(decision, 'value'), false);
});

test('the chain is entered exactly once', async () => {
  let calls = 0;
  const listener = createListProjector({ config: () => settings });
  const counter = async (exec, result, next) => {
    calls += 1;
    return next();
  };
  await runWaterfall([listener, counter], execution('list_plugins'), dispatched(pluginText));
  assert.equal(calls, 1);
});
