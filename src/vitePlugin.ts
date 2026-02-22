import type { Plugin } from "vite";
import { createPlugin } from "./plugin.js";

/**
 * @deprecated Use `foundryvtt-sync/vite` import instead:
 * ```typescript
 * import foundryvttSync from 'foundryvtt-sync/vite'
 * // Then use: foundryvttSync({ id: 'my-module' }, options)
 * ```
 *
 * Vite plugin for FoundryVTT compendium sync.
 * Includes dev server features (HMR, WebSocket).
 *
 * @param moduleJSON The module.json data. Best imported raw.
 * @param moduleJSON.id The module ID.
 * @param _options Where to store, compile, and how to transform data.
 */
export default function vttSync(
	moduleJSON: { id: string },
	_options?: Parameters<typeof createPlugin>[1],
): Plugin[] {
	// Get the vite plugin from unplugin
	const pluginFactory = createPlugin(moduleJSON, _options).vite;
	// Call the factory to get the plugin(s)
	const plugins = pluginFactory();
	// Return as array for backwards compatibility
	return Array.isArray(plugins) ? plugins : [plugins];
}
