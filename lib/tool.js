/**
 * dsh-plugin-query-enhance - the query tool (mechanism 2).
 *
 * A second mechanism exists because the first one cannot be steered: a plugin
 * cannot add parameters to another plugin's tool, so `plugin_manager`'s list
 * actions always answer with what they always answered, only smaller. This tool
 * is the steerable half - the caller states what it wants and the host returns
 * only that - and it is the only path that can return a complete record.
 *
 * The definition is written as the raw JSON Schema the registry enforces rather
 * than through the first-party `defineTool` helper. That helper lives in
 * `@deepseek-ai/dsh-tools`, and importing it would make this package depend on a
 * Host package at a pinned version: a clone would then need a registry round trip
 * before it could even load, and a Host upgrade could silently desynchronize the
 * two copies. The registry's own contract - "Tool plugins call
 * `ctx.tools.register()`" - is the stable surface, and it takes the compiled form.
 * The cost of skipping the helper is that argument validation, which the helper
 * would otherwise install, is done here instead.
 *
 * @module dsh-plugin-query-enhance/tool
 */

import { DEFAULT_LIMIT, MAX_LIMIT } from './config.js';
import { query } from './filter.js';

/** The tool name a caller sees. Unique across the profile. */
export const TOOL_NAME = 'plugin_query';

/**
 * The model-facing description.
 *
 * Two jobs in one paragraph, because this text is a per-request cost: say what
 * the tool does, and say why it should be chosen over the action it overlaps.
 */
export const TOOL_DESCRIPTION =
  'Read the current profile bundles or plugin entries with the filtering done before anything is returned, so ' +
  'only the records a decision needs come back. Prefer this over plugin_manager list_bundles and list_plugins ' +
  'when you know what you are looking for: those actions answer with every bundle and the complete list of ' +
  'plugin rows it declares, or with a page of plugin entries you did not choose. Read-only, changes nothing, ' +
  'and needs no approval.';

/**
 * Parameters, in the raw JSON Schema subset the tool registry enforces:
 * type/oneOf/properties/required/additionalProperties/items/enum/const plus
 * description. Every parameter is optional; the defaults are stated in each
 * description so the schema alone is enough to call this correctly.
 */
export const TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: ['bundles', 'plugins'],
      description: 'Which inventory to read. Defaults to "bundles".',
    },
    name: {
      type: 'string',
      description: 'Exact bundle package name, for example "@deepseek-ai/dsh-base". Bundles only.',
    },
    match: {
      type: 'string',
      description:
        'Case-insensitive substring over the package name, the description, and the module names of the rows a ' +
        'bundle declares. That last part answers "which bundle provides this plugin" without reading every row list.',
    },
    enabled: {
      type: 'boolean',
      description: 'Keep only records whose saved enabled state is this value.',
    },
    installed: {
      type: 'boolean',
      description: 'Keep only bundles whose installed state is this value. Bundles only.',
    },
    optional: {
      type: 'boolean',
      description: 'Keep only bundles shipped switched off for the user to turn on. Bundles only.',
    },
    hasError: {
      type: 'boolean',
      description: 'true keeps only bundles that failed to load; false keeps only the ones that loaded. Bundles only.',
    },
    detail: {
      type: 'string',
      enum: ['summary', 'full'],
      description:
        'summary returns one line per record. full returns the complete management record - the declared ' +
        'plugin rows, the package description, patch ids, and the diagnostics nested in error. This is the ' +
        'only way to obtain a complete record.',
    },
    includeRows: {
      type: 'boolean',
      description: 'In a summary, also include the declared plugin rows. Bundles only.',
    },
    limit: {
      type: 'integer',
      description: 'Page size, 1 to ' + MAX_LIMIT + '. Defaults to ' + DEFAULT_LIMIT + '.',
    },
    offset: {
      type: 'integer',
      description: 'Zero-based offset into the filtered result. Defaults to 0.',
    },
  },
};

/** Filters only a bundle record can answer. Supplying one for plugins is an error. */
export const BUNDLE_ONLY_ARGUMENTS = ['name', 'installed', 'optional', 'hasError', 'includeRows'];

/**
 * Validate and default the arguments of one call.
 *
 * Unknown keys are dropped rather than forwarded, so a caller cannot smuggle a
 * field past the schema by naming it something the registry does not check.
 *
 * @param {unknown} raw the arguments the registry passed through
 * @returns {object} the normalized arguments
 * @throws {Error} when a value is malformed or a bundle-only filter is used for plugins
 */
export function normalizeArguments(raw) {
  const args = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

  const kind = args.kind === undefined ? 'bundles' : args.kind;
  if (kind !== 'bundles' && kind !== 'plugins') throw new Error('kind must be "bundles" or "plugins"');
  if (kind === 'plugins') {
    for (const key of BUNDLE_ONLY_ARGUMENTS) {
      if (args[key] !== undefined) throw new Error('"' + key + '" applies to kind "bundles" only');
    }
  }

  const normalized = { kind };
  if (args.name !== undefined) normalized.name = requireText(args.name, 'name');
  if (args.match !== undefined) normalized.match = requireText(args.match, 'match');
  for (const key of ['enabled', 'installed', 'optional', 'hasError', 'includeRows']) {
    if (args[key] !== undefined) normalized[key] = requireBoolean(args[key], key);
  }
  if (args.detail !== undefined) {
    if (args.detail !== 'summary' && args.detail !== 'full') throw new Error('detail must be "summary" or "full"');
    normalized.detail = args.detail;
  }
  normalized.limit = requireLimit(args.limit);
  normalized.offset = requireOffset(args.offset);
  return normalized;
}

/**
 * @param {unknown} value candidate
 * @param {string} label parameter name, for the message
 * @returns {string} the value
 */
function requireText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      '"' + label + '" must be a non-empty string; omit it rather than passing an empty one, which would match everything',
    );
  }
  return value;
}

/**
 * @param {unknown} value candidate
 * @param {string} label parameter name, for the message
 * @returns {boolean} the value
 */
function requireBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error('"' + label + '" must be a boolean');
  return value;
}

/**
 * @param {unknown} value candidate
 * @returns {number} the page size
 */
function requireLimit(value) {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new Error('limit must be an integer from 1 to ' + MAX_LIMIT);
  }
  return value;
}

/**
 * @param {unknown} value candidate
 * @returns {number} the offset
 */
function requireOffset(value) {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0) throw new Error('offset must be a non-negative integer');
  return value;
}

/**
 * Build the registry-ready tool definition.
 *
 * `readInventory` is injected rather than reached for, so the definition can be
 * exercised in a test without a Host, and so the only code that touches a Host
 * service stays in the entry point.
 *
 * @param {object} options
 * @param {(kind: 'bundles'|'plugins') => Promise<unknown[]>|unknown[]} options.readInventory reads one inventory
 * @param {() => {defaultDetail: string}} options.config effective plugin settings
 * @returns {object} the definition to pass to `ctx.tools.register()`
 */
export function createQueryTool({ readInventory, config }) {
  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: TOOL_PARAMETERS,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const normalized = normalizeArguments(args);
      const rows = await readInventory(normalized.kind);
      return JSON.stringify(query({ kind: normalized.kind, rows, args: normalized, config: config() }));
    },
  };
}
