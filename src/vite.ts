import { createPlugin } from "./plugin.js";

/**
 * Vite plugin for FoundryVTT compendium sync.
 * Includes dev server features (HMR, WebSocket).
 *
 * @param moduleJSON The module.json data. Best imported raw.
 * @param moduleJSON.id The module ID.
 * @param options Where to store, compile, and how to transform data.
 */
export default function foundryvttSyncVite(
	moduleJSON: { id: string },
	options?: Parameters<typeof createPlugin>[1],
) {
	return createPlugin(moduleJSON, options).vite;
}
