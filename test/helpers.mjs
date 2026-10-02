/**
 * Shared fixtures for the test suite.
 *
 * The records below are shaped exactly like the ones
 * `pluginManager.listBundles()` and `listPlugins()` produce, including the `meta`
 * display metadata that the Web Client needs and a model must never receive.
 * Nothing here touches the filesystem, the network, or a Host.
 *
 * @module dsh-plugin-query-enhance/test/helpers
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the package root. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string} relative path from the package root
 * @returns {object} the parsed JSON
 */
export function readJson(relative) {
  return JSON.parse(readFileSync(join(ROOT, relative), 'utf8'));
}

/**
 * Display metadata as the Client projections carry it.
 * @returns {object} a meta object
 */
export function displayMeta() {
  return {
    title: { en: 'Title', zh: '标题' },
    description: { en: 'Display text the Client renders.', zh: '客户端渲染的显示文本。' },
    icon: './icon.svg',
  };
}

/**
 * One declared plugin row, as a bundle declares it.
 * @param {object} spec row fields
 * @param {string} spec.rowId declared row id
 * @param {string} spec.moduleName package the row loads
 * @param {string} [spec.entryId] live Loader entry id, when the row is mounted
 * @returns {object} the row record
 */
export function rowFixture(spec) {
  const row = { rowId: spec.rowId, moduleName: spec.moduleName, meta: displayMeta() };
  if (spec.entryId !== undefined) row.entryId = spec.entryId;
  return row;
}

/**
 * One bundle record.
 * @param {object} spec bundle fields
 * @returns {object} the bundle record
 */
export function bundleFixture(spec) {
  const record = {
    name: spec.name,
    enabled: spec.enabled !== false,
    installed: spec.installed !== false,
    optional: spec.optional === true,
    removable: spec.removable !== false,
    rows: (spec.rows ?? []).map(rowFixture),
    overrides: spec.overrides ?? [],
    meta: displayMeta(),
  };
  if (spec.version !== undefined) record.version = spec.version;
  if (spec.description !== undefined) record.description = spec.description;
  if (spec.error !== undefined) record.error = spec.error;
  if (spec.readOnlyReason !== undefined) record.readOnlyReason = spec.readOnlyReason;
  return record;
}

/**
 * One plugin entry, as `listPlugins()` reports it.
 * @param {object} spec entry fields
 * @returns {object} the plugin record
 */
export function pluginFixture(spec) {
  const record = {
    entryId: spec.entryId,
    moduleName: spec.moduleName,
    enabled: spec.enabled !== false,
    fiberPhase: spec.fiberPhase === undefined ? 'active' : spec.fiberPhase,
    meta: displayMeta(),
  };
  if (spec.patchId !== undefined) record.patchId = spec.patchId;
  if (spec.readOnlyReason !== undefined) record.readOnlyReason = spec.readOnlyReason;
  return record;
}

/**
 * Wrap entries in the envelope both list actions return.
 * @param {object[]} entries list entries
 * @param {object} [extra] envelope overrides
 * @returns {object} the payload
 */
export function listPayload(entries, extra = {}) {
  return { entries, total: entries.length, nextOffset: null, ...extra };
}

/**
 * A payload sized like the real thing, for byte-budget assertions.
 *
 * The management tool returns declared rows for every bundle, and a base bundle
 * in a real profile declares dozens of them. This reproduces that shape without
 * depending on any particular profile.
 *
 * @param {object} [options]
 * @param {number} [options.bundleCount] bundles to generate
 * @param {number} [options.rowsEach] declared rows per bundle
 * @returns {object} the payload
 */
export function realisticPayload({ bundleCount = 2, rowsEach = 60 } = {}) {
  const entries = [];
  for (let index = 0; index < bundleCount; index += 1) {
    const rows = [];
    for (let row = 0; row < rowsEach; row += 1) {
      rows.push({
        rowId: 'row-' + index + '-' + row,
        moduleName: '@deepseek-ai/dsh-example-plugin-' + index + '-' + row,
        entryId: 'include:example-' + index + '-' + row,
      });
    }
    // Built without meta on purpose: the management tool strips display
    // metadata before the projection runs, so a fixture carrying it would
    // overstate the reduction being measured.
    entries.push({
      name: '@deepseek-ai/dsh-example-bundle-' + index,
      version: '0.1.2-alpha.1',
      description: 'A profile bundle: the shared core, applied as one patch layer over the profile root. '.repeat(2),
      enabled: true,
      installed: true,
      optional: false,
      removable: true,
      rows,
      overrides: ['a-built-in-row', 'another-built-in-row'],
    });
  }
  return listPayload(entries);
}

/**
 * A page of plugin entries sized like the real thing.
 *
 * Also built without meta, for the same reason: \u00A7list_plugins\u00A7 has already
 * dropped it by the time the projection sees the payload.
 *
 * @param {object} [options]
 * @param {number} [options.count] entries in the page
 * @returns {object} the payload
 */
export function realisticPluginPayload({ count = 25 } = {}) {
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    entries.push({
      entryId: 'entry-' + index,
      moduleName: '@deepseek-ai/dsh-example-plugin-' + index,
      enabled: index % 2 === 0,
      fiberPhase: index % 3 === 0 ? 'active' : 'pending',
      patchId: 'patch-' + index,
    });
  }
  return listPayload(entries, { total: 187 });
}

/**
 * Run one `tools/post-execute` waterfall the way the tool runtime does.
 *
 * Listeners run in order; each receives `(exec, result, next)` and returns a
 * decision. The terminal listener accepts the dispatched result unchanged.
 *
 * @param {Function[]} listeners registered listeners, in order
 * @param {object} exec the execution
 * @param {object} result the dispatched result
 * @returns {Promise<object>} the final decision
 */
export function runWaterfall(listeners, exec, result) {
  let index = -1;
  const step = async () => {
    index += 1;
    const listener = listeners[index];
    if (listener === undefined) return { kind: 'accept' };
    return listener(exec, result, step);
  };
  return step();
}
