import { createPlugin } from "./plugin.js";
/**
 * Webpack plugin for FoundryVTT compendium sync.
 *
 * @param moduleJSON The module.json data. Best imported raw.
 * @param moduleJSON.id The module ID.
 * @param options Where to store, compile, and how to transform data.
 */
export default function foundryvttSyncWebpack(moduleJSON, options) {
    return createPlugin(moduleJSON, options).webpack;
}
//# sourceMappingURL=webpack.js.map