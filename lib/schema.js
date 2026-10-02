/**
 * dsh-plugin-query-enhance - the configuration schema.
 *
 * The only module in this package that imports anything at runtime. It exists
 * separately from `config.js` so that nothing else - and in particular no test -
 * has to resolve a dependency in order to load.
 *
 * Cordis reads the exported `Config` to validate the row config before
 * `apply()` runs, and DSH projects it into the JSON Schema its configuration
 * surfaces describe.
 *
 * @module dsh-plugin-query-enhance/schema
 */

import z from '@deepseek-ai/schemastery';
import { DEFAULT_DETAIL, DETAIL_LEVELS } from './config.js';

/**
 * The plugin's configuration schema.
 *
 * Both fields are ordinary configuration, not volatile ones: this plugin has no
 * settings page, so there is nothing that needs to be written in place while the
 * Host runs. Change a value in the bundle's own `cordis.patch.yml` and reinstall.
 */
export const Config = z.object({
  intercept: z
    .boolean()
    .default(true)
    .description('Project plugin_manager list_bundles results down to one summary line per bundle.'),

  defaultDetail: z
    .union(DETAIL_LEVELS)
    .default(DEFAULT_DETAIL)
    .description('Detail level plugin_query applies when a call omits detail.'),
});
