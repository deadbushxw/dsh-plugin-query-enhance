/**
 * dsh-plugin-query-enhance - effective settings.
 *
 * One layer, deliberately: the plugin row's `config` in `cordis.patch.yml`. There
 * is no configuration file and no settings page - a value that lives inside this
 * repository is a value that can end up in a commit, and the point of this
 * package is that the published tree contains source and documentation only.
 *
 * This module holds the constants and the resolution logic, and imports nothing.
 * The schema that validates the row lives in `schema.js`, which is the one file in
 * the package that needs a runtime dependency - keeping them apart is what lets
 * the whole test suite run on a fresh clone with no install step.
 *
 * @module dsh-plugin-query-enhance/config
 */

/** Stable plugin identity: package name, Loader row id, and display name. */
export const PLUGIN_ID = 'dsh-plugin-query-enhance';

/** The two detail levels `plugin_query` accepts. */
export const DETAIL_LEVELS = ['summary', 'full'];

/** Detail level used when a call omits `detail`. */
export const DEFAULT_DETAIL = 'summary';

/** Page size used when a call omits `limit`. */
export const DEFAULT_LIMIT = 10;

/** Largest page this tool will return, matching the management tool's own cap. */
export const MAX_LIMIT = 100;

/**
 * Resolve the effective settings from the row config.
 *
 * Called once at activation. A value outside the schema is not repaired so much
 * as ignored: the Loader has already validated and defaulted the row, and a
 * hand-written config that skipped that step must still leave the plugin usable.
 *
 * @param {unknown} raw the row config
 * @returns {{intercept: boolean, defaultDetail: string}}
 */
export function normalizeConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  return {
    intercept: source.intercept !== false,
    defaultDetail: DETAIL_LEVELS.includes(source.defaultDetail) ? source.defaultDetail : DEFAULT_DETAIL,
  };
}
