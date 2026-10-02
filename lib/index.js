/**
 * dsh-plugin-query-enhance - Host plugin entry.
 *
 * One Host-side DSH plugin with two mechanisms over the same inventory:
 *
 *   1. a `tools/post-execute` projection that shrinks the payload of
 *      `plugin_manager list_bundles` before it is serialized, so a caller that
 *      did not know to ask for less still does not receive the whole table;
 *   2. a `plugin_query` tool that takes filters, for a caller that does know
 *      what it is looking for.
 *
 * Neither one touches `@deepseek-ai/dsh-plugin-manager`. The core stays exactly
 * as shipped, the Web Client keeps reading the service directly, and removing
 * this bundle restores the previous behaviour completely - which is also what
 * keeps it installable from a public repository instead of a fork.
 *
 * Layout:
 *   config.js    constants and effective settings (imports nothing)
 *   schema.js    the Config schema (the one runtime dependency)
 *   shape.js     display-metadata stripping, shared by both mechanisms
 *   project.js   mechanism 1: summarize a whole list_bundles payload
 *   filter.js    mechanism 2: the query engine
 *   tool.js      mechanism 2: the tool definition and its argument contract
 *   intercept.js mechanism 1: the tools/post-execute listener
 *
 * @module dsh-plugin-query-enhance
 */

import { PLUGIN_ID, normalizeConfig } from './config.js';
import { createListProjector } from './intercept.js';
import { Config } from './schema.js';
import { createQueryTool } from './tool.js';

/** Cordis plugin name, used by the Loader for diagnostics. */
export const name = PLUGIN_ID;

/**
 * The tool runtime is required: without it there is no registry to register into
 * and no waterfall to join, so the plugin has nothing to do.
 *
 * `pluginManager` is deliberately *not* listed here. It is reached through
 * `ctx.inject` below instead, so a profile without the management service still
 * gets the projection half rather than the whole plugin refusing to activate.
 */
export const inject = ['tools'];

export { Config };

/**
 * Minimal logger used when the Host has no logger service available.
 * @returns a console-backed logger
 */
function consoleLogger() {
  return {
    debug: () => {},
    info: () => {},
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
  };
}

/**
 * Resolve a logger from the Host context without assuming its exact shape.
 * @param ctx the plugin context
 * @returns a logger with debug/info/warn/error
 */
function resolveLogger(ctx) {
  try {
    const service = ctx?.logger;
    if (service === undefined || service === null) return consoleLogger();
    if (typeof service === 'function') {
      const named = service(PLUGIN_ID);
      if (named !== undefined && named !== null && typeof named.warn === 'function') return named;
    }
    if (typeof service.warn === 'function') return service;
  } catch {
    /* fall through to the console logger */
  }
  return consoleLogger();
}

/**
 * Wire the plugin into the Host.
 *
 * Both mechanisms are registered inside one effect each, so disposal removes the
 * waterfall listener and unregisters the tool together.
 *
 * @param ctx the plugin context
 * @param config the resolved row configuration
 */
export function apply(ctx, config) {
  const log = resolveLogger(ctx);
  const settings = normalizeConfig(config);

  ctx.effect(
    () => {
      const off = ctx.on('tools/post-execute', createListProjector({ config: () => settings, log }));
      return () => off?.();
    },
    PLUGIN_ID + ' list projection',
  );

  // Optional service: absent in a profile that does not mount the manager, in
  // which case the projection above still applies and this tool simply is not
  // registered.
  ctx.inject(['pluginManager'], (scoped) => {
    scoped.effect(
      () =>
        scoped.tools.register(
          createQueryTool({
            readInventory: (kind) =>
              kind === 'bundles' ? scoped.pluginManager.listBundles() : scoped.pluginManager.listPlugins(),
            config: () => settings,
          }),
        ),
      PLUGIN_ID + ' query tool',
    );
  });

  log?.debug?.(
    PLUGIN_ID + ': ready (intercept=' + settings.intercept + ', defaultDetail=' + settings.defaultDetail + ')',
  );
}
