/**
 * dsh-plugin-query-enhance - the query engine (mechanism 2).
 *
 * Every decision that determines the answer happens here, on the host side and
 * before serialization: which records survive, which detail is built, and how
 * much of it fits in one page. There is no later pass that trims a payload the
 * caller already paid for.
 *
 * @module dsh-plugin-query-enhance/filter
 */

import { summarizeBundle, summarizePluginEntry } from './project.js';
import { withoutDisplayMeta } from './shape.js';

/**
 * Run one query over an inventory the caller already read.
 *
 * @param {object} options
 * @param {'bundles'|'plugins'} options.kind which inventory this is
 * @param {unknown[]} options.rows the raw inventory
 * @param {object} options.args validated and defaulted arguments
 * @param {{defaultDetail: string}} options.config effective plugin settings
 * @returns {{kind: string, entries: object[], total: number, matched: number, nextOffset: number|null}}
 */
export function query({ kind, rows, args, config }) {
  const criteria = buildCriteria(args);
  const source = Array.isArray(rows) ? rows : [];
  const matched = source.filter((row) => matches(row, criteria, kind));
  const offset = args.offset;
  const page = matched.slice(offset, offset + args.limit);
  const detail = args.detail === undefined ? config.defaultDetail : args.detail;
  const entries = page.map((row) => present(row, kind, detail, criteria.match, args.includeRows === true));
  const consumed = offset + entries.length;
  return {
    kind,
    entries,
    total: source.length,
    matched: matched.length,
    nextOffset: consumed < matched.length ? consumed : null,
  };
}

/**
 * Turn validated arguments into the comparison values used for filtering.
 *
 * `match` is lowercased once here, not once per record.
 *
 * @param {object} args validated arguments
 * @returns {object} the criteria actually applied
 */
function buildCriteria(args) {
  const criteria = {};
  if (args.name !== undefined) criteria.name = args.name;
  if (args.match !== undefined) criteria.match = args.match.toLowerCase();
  if (args.enabled !== undefined) criteria.enabled = args.enabled;
  if (args.installed !== undefined) criteria.installed = args.installed;
  if (args.optional !== undefined) criteria.optional = args.optional;
  if (args.hasError !== undefined) criteria.hasError = args.hasError;
  return criteria;
}

/**
 * Whether one record satisfies every supplied criterion.
 *
 * Criteria combine with AND. A criterion that a record shape cannot answer is
 * rejected at the argument boundary, never ignored here: quietly dropping a
 * filter would return rows the caller did not ask for.
 *
 * @param {unknown} row one inventory record
 * @param {object} criteria conditions to satisfy
 * @param {'bundles'|'plugins'} kind which inventory this is
 * @returns {boolean}
 */
function matches(row, criteria, kind) {
  if (row === null || typeof row !== 'object') return false;
  if (criteria.name !== undefined && row.name !== criteria.name) return false;
  if (criteria.enabled !== undefined && row.enabled !== criteria.enabled) return false;
  if (criteria.match !== undefined && !haystack(row, kind).includes(criteria.match)) return false;
  if (kind === 'plugins') return true;
  if (criteria.installed !== undefined && row.installed !== criteria.installed) return false;
  if (criteria.optional !== undefined && row.optional !== criteria.optional) return false;
  if (criteria.hasError !== undefined && (row.error !== undefined) !== criteria.hasError) return false;
  return true;
}

/**
 * Build the lowercase text one record is matched against.
 *
 * For a bundle this deliberately includes the module names of the rows it
 * declares, so "which bundle provides this plugin" is answerable without first
 * reading every bundle's row list - which is the query this package exists to
 * make unnecessary.
 *
 * @param {object} row one inventory record
 * @param {'bundles'|'plugins'} kind which inventory this is
 * @returns {string}
 */
function haystack(row, kind) {
  const parts = [row.name, row.description];
  if (kind === 'plugins') parts.push(row.moduleName, row.entryId);
  else if (Array.isArray(row.rows)) for (const declared of row.rows) parts.push(rowHaystack(declared));
  return parts.filter((part) => typeof part === 'string').join('\n').toLowerCase();
}

/**
 * @param {object} declared one declared bundle row
 * @returns {string} the lowercase text of that row
 */
function rowHaystack(declared) {
  if (declared === null || typeof declared !== 'object') return '';
  return [declared.rowId, declared.moduleName]
    .filter((part) => typeof part === 'string')
    .join('\n')
    .toLowerCase();
}

/**
 * Build the record the caller receives.
 *
 * `detail: "full"` reproduces the management tool's own record, with the declared
 * rows narrowed to those a `match` actually hit. `detail: "summary"` is one line per
 * record; `includeRows` adds the row list back for a caller that needs the ids.
 *
 * This is the only path that ever returns a complete record. The projection on
 * the management tool deliberately never does.
 *
 * @param {unknown} row one matching record
 * @param {'bundles'|'plugins'} kind which inventory this is
 * @param {string} detail resolved detail level
 * @param {string|undefined} match lowercase match text, when one was given
 * @param {boolean} includeRows whether a summary should carry the row list
 * @returns {object}
 */
function present(row, kind, detail, match, includeRows) {
  const clean = withoutDisplayMeta(row);
  if (kind === 'plugins') return detail === 'full' ? clean : summarizePluginEntry(clean);
  const declared = Array.isArray(clean.rows) ? clean.rows : [];
  const selected = match === undefined ? declared : declared.filter((entry) => rowHaystack(entry).includes(match));
  if (detail === 'full') return { ...clean, rows: selected };
  const record = summarizeBundle(clean);
  if (includeRows) record.rows = selected;
  return record;
}
