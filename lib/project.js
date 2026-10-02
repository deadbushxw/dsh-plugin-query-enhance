/**
 * dsh-plugin-query-enhance - the list projection (mechanism 1).
 *
 * Both list actions are the management surface, and both answer a question the
 * caller did not ask:
 *
 *   - `list_bundles` returns every bundle with the complete list of plugin rows
 *     that bundle declares. Those rows dominate the payload: a base bundle in a
 *     real profile declares dozens. A caller asking "is this bundle enabled"
 *     needs four booleans.
 *   - `list_plugins` returns a page of plugin entries the caller never chose.
 *     Each one is small, but the default page is twenty-five and the cap is a
 *     hundred, and the entries are not filtered by anything the caller said.
 *
 * The registry gives no way for a plugin to extend another tool's parameters, so
 * this cannot add a filter to either action. It does not need to: the projection
 * runs inside the Host, before the payload is ever serialized, so the bytes are
 * never produced rather than produced and then ignored by the reader. Filtering,
 * and any full record, is `plugin_query`'s job.
 *
 * @module dsh-plugin-query-enhance/project
 */

import { withoutDisplayMeta } from './shape.js';

/**
 * Reduce one bundle record to the fields a decision actually uses.
 *
 * Kept: identity, the four saved-state booleans, why it is read-only, the error
 * code, and the size of what was dropped. Everything dropped is either UI text
 * (`description`) or bulk (`rows`, `overrides`, the diagnostics nested in `error`).
 *
 * `error` collapses from an object to its code string. The code is the part that
 * decides the next step (`not-bundle`, `management-required`, ...); the diagnostic
 * prose and the incompatible-peer list are what a human reads, and `plugin_query`
 * returns them at `detail: "full"` for whoever actually needs them.
 *
 * @param {object} bundle a bundle record, already stripped of display metadata
 * @returns {object} the summary record
 */
export function summarizeBundle(bundle) {
  const record = { name: bundle.name };
  if (bundle.version !== undefined) record.version = bundle.version;
  record.enabled = bundle.enabled;
  record.installed = bundle.installed;
  record.optional = bundle.optional;
  record.removable = bundle.removable;
  if (bundle.readOnlyReason !== undefined) record.readOnlyReason = bundle.readOnlyReason;
  if (bundle.error !== undefined && bundle.error !== null) record.error = bundle.error.code;
  record.rowCount = Array.isArray(bundle.rows) ? bundle.rows.length : 0;
  if (Array.isArray(bundle.overrides) && bundle.overrides.length > 0) record.overrideCount = bundle.overrides.length;
  return record;
}

/**
 * Reduce one plugin entry to the fields a decision actually uses.
 *
 * There is less to remove here than on a bundle, because the management tool has
 * already dropped the localized display metadata. What is left is small but not
 * free: the default page is twenty-five entries and the cap is a hundred.
 *
 * Kept: `entryId`, because it is the argument `set_plugin` takes; `moduleName`,
 * because it is how a reader recognizes the plugin; and the two state fields. The
 * one field dropped is `patchId`, the profile patch row that addresses the entry
 * - it is not an argument any documented operation takes, and `plugin_query`
 * returns it at `detail: "full"`.
 *
 * @param {object} entry a plugin entry, already stripped of display metadata
 * @returns {object} the summary record
 */
export function summarizePluginEntry(entry) {
  const record = {
    entryId: entry.entryId,
    moduleName: entry.moduleName,
    enabled: entry.enabled,
    fiberPhase: entry.fiberPhase,
  };
  if (entry.readOnlyReason !== undefined) record.readOnlyReason = entry.readOnlyReason;
  return record;
}

/**
 * Project a whole list payload, for either action.
 *
 * The entry shape decides what a summary keeps, so one function serves both
 * actions and neither has to tell it which one it is. An entry shaped like
 * neither is passed through untouched rather than guessed at.
 *
 * The envelope is preserved unchanged - `total` and `nextOffset` keep the
 * meaning the management tool gave them, so a reader that already understands
 * that shape needs no new keys.
 *
 * @param {unknown} payload the parsed value of the management tool's result
 * @returns {unknown} the same envelope with summarized entries
 */
export function projectListPayload(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  if (!Array.isArray(payload.entries)) return payload;
  return { ...payload, entries: payload.entries.map(summarizeEntry) };
}

/**
 * @param {unknown} entry one list entry
 * @returns {unknown} its summary, or the entry unchanged when unrecognized
 */
function summarizeEntry(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  const clean = withoutDisplayMeta(entry);
  if (Array.isArray(clean.rows)) return summarizeBundle(clean);
  if (typeof clean.entryId === 'string') return summarizePluginEntry(clean);
  return entry;
}
