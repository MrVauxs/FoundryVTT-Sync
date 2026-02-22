import { createPlugin } from "./plugin.js";
/**
 * esbuild plugin for FoundryVTT compendium sync.
 *
 * @param moduleJSON The module.json data. Best imported raw.
 * @param moduleJSON.id The module ID.
 * @param options Where to store, compile, and how to transform data.
 */
export default function foundryvttSyncEsbuild(moduleJSON, options) {
    return createPlugin(moduleJSON, options).esbuild;
}
//# sourceMappingURL=esbuild.js.map