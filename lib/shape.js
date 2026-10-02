/**
 * dsh-plugin-query-enhance - record shaping shared by both mechanisms.
 *
 * @module dsh-plugin-query-enhance/shape
 */

/**
 * Drop the UI display metadata from one bundle or plugin entry.
 *
 * `pluginManager.listBundles()` and `listPlugins()` carry a `meta` object for the Web
 * Client: localized titles, localized descriptions, and an icon path, on the
 * bundle and again on every row it declares. The management tool already strips
 * it before returning anything to a model, because a Client renders it and a
 * model cannot. Both mechanisms here read the service directly, so both have to
 * strip it for themselves; skipping this would reintroduce the exact bytes the
 * package exists to remove.
 *
 * @param {unknown} entry a bundle or plugin entry, or anything else
 * @returns {unknown} the same record without `meta` at either level
 */
export function withoutDisplayMeta(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  const { meta: _meta, ...rest } = entry;
  if (!Array.isArray(rest.rows)) return rest;
  return { ...rest, rows: rest.rows.map(withoutRowMeta) };
}

/**
 * @param {object} row one declared bundle row
 * @returns {object} the row without its display metadata
 */
function withoutRowMeta(row) {
  if (row === null || typeof row !== 'object') return row;
  const { meta: _rowMeta, ...rest } = row;
  return rest;
}
