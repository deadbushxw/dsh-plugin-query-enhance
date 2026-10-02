/**
 * dsh-plugin-query-enhance - the list projection hook (mechanism 1).
 *
 * Registered on the `tools/post-execute` waterfall, which the tool runtime
 * documents as the place to transform a result. Both list actions are targeted:
 * which one a caller reaches for is not predictable, and leaving either of them
 * whole would leave a path where the entire table comes back.
 *
 * Two rules from the plugin guidance shape the code below:
 *
 *   - a waterfall listener that does not own the decision must call `next()`, so
 *     every call that is not one we target is delegated untouched;
 *   - the strongest mechanism that suffices is the one to use, and other
 *     plugins' decisions are ours to preserve, not to override.
 *
 * The second rule is why the listener calls `next()` *before* deciding anything,
 * even for the calls it does own, and then transforms whatever the rest of the
 * chain settled on. A later listener - for example a tool-hook plugin - has
 * already had its say, and if it replaced the value or blocked the result, this
 * listener returns that decision unchanged instead of fighting it.
 *
 * @module dsh-plugin-query-enhance/intercept
 */

import { projectListPayload } from './project.js';

/** The tool this listener rewrites results for. */
const TARGET_TOOL = 'plugin_manager';

/** The actions it rewrites. Everything else is delegated. */
const TARGET_ACTIONS = new Set(['list_bundles', 'list_plugins']);

/**
 * Build the `tools/post-execute` listener.
 *
 * Failure never propagates: anything unexpected here - an unparsable payload, a
 * future Host that changed the envelope, a shape this version does not
 * recognize - falls back to the untouched result. A projection that cannot run
 * must cost the caller nothing, never break a working management call.
 *
 * @param {object} options
 * @param {() => {intercept: boolean}} options.config effective plugin settings
 * @param {{debug?: Function, warn?: Function}} [options.log] Host logger, when present
 * @returns {Function} a listener for `ctx.on('tools/post-execute', ...)`
 */
export function createListProjector({ config, log }) {
  return async function projectListResults(exec, result, next) {
    // Delegate every call this listener does not rewrite. A waterfall listener
    // that returned a decision here would end the chain for all of them.
    if (exec?.name !== TARGET_TOOL || !TARGET_ACTIONS.has(exec?.arguments?.action)) return next();

    // Let the rest of the chain decide first. Whatever it settles on is the
    // decision this listener refines, or defers to.
    const downstream = await next();

    try {
      if (config().intercept !== true) return downstream;
      if (downstream === null || typeof downstream !== 'object' || downstream.kind !== 'accept') return downstream;
      // Someone downstream already replaced the result; two replacements is a
      // contradiction, and the runtime rejects a decision carrying both.
      if (Object.hasOwn(downstream, 'content') || Object.hasOwn(downstream, 'value')) return downstream;
      // A failed result keeps its own value: the runtime refuses to replace it.
      if (result === null || typeof result !== 'object' || result.isError === true) return downstream;
      if (typeof result.value !== 'string') return downstream;

      const payload = JSON.parse(result.value);
      const projected = JSON.stringify(projectListPayload(payload));
      if (projected === result.value) return downstream;
      return { ...downstream, value: projected };
    } catch (error) {
      log?.debug?.(TARGET_TOOL + ': left a list result unprojected: ' + (error?.message ?? error));
      return downstream;
    }
  };
}
