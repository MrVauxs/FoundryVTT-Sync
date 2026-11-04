import type Document from "@7h3laughingman/foundry-types/common/abstract/document.mjs";
import type { ResolvedConfig, ViteDevServer } from "vite";
import type { LiveSyncExtractOptions } from "./liveSync.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import { createUnplugin } from "unplugin";
import { setupLiveSync } from "./liveSync.js";
import { log } from "./logs.js";

/**
 * @prop { dataDirectory } - The directory to watch for updates in. Defaults to "data".
 * @prop { outputDirectory } - The directory to write the pack files to. Defaults to "packs".
 * @prop { transformer } - A function that takes a Document["_source"] and returns a Promise<Document["_source"]> | Document["_source"] | Promise<false> | false. Live sync runs it on every document before writing it to the data directory. Returning false skips the write. Defaults to no transformation.
 * @prop { ignoreAdventureHMR } - Whether live sync should leave Adventure documents alone, in both directions.
 * @prop { extractOptions } - The foundryvtt-cli `extractPack` options live sync uses to write documents, so its files match your extract script. Defaults to `{ folders: true, expandAdventures: true, omitVolatile: true, jsonOptions: { space: "\t" } }`.
 */
export interface PluginOptions {
	dataDirectory?: string;
	outputDirectory?: string;
	transformer?: (doc: Document["_source"]) => Promise<void> | void | Promise<false> | false;
	ignoreAdventureHMR?: boolean;
	ignoreNestedFolders?: boolean;
	extractOptions?: LiveSyncExtractOptions;
}

const defaultOptions: Required<PluginOptions> = {
	dataDirectory: "data",
	outputDirectory: "packs",
	transformer: () => { },
	ignoreAdventureHMR: false,
	ignoreNestedFolders: false,
	extractOptions: {
		folders: true,
		expandAdventures: true,
		omitVolatile: true,
		jsonOptions: { space: "\t" },
	},
} as const;

/** Module ID of the browser half of live sync, which the dev server adds to the module's entry. */
const CLIENT_ID = "virtual:foundryvtt-sync/client";
const RESOLVED_CLIENT_ID = `\0${CLIENT_ID}`;
const CLIENT_FILE = fileURLToPath(new URL("./compendiumSync.js", import.meta.url));

const toPosix = (file: string) => file.replaceAll("\\", "/");

/** The entry files of the Vite build, which the dev server serves to Foundry as the module's script. */
function entryFiles(config: ResolvedConfig): Set<string> {
	const build = config.build as ResolvedConfig["build"] & { rolldownOptions?: { input?: unknown } };
	const inputs: unknown[] = [build.lib ? build.lib.entry : undefined, build.rolldownOptions?.input ?? build.rollupOptions?.input];
	const files = inputs.flatMap(input => typeof input === "string" ? [input] : Array.isArray(input) ? input : input && typeof input === "object" ? Object.values(input) : []);
	return new Set(files.filter(file => typeof file === "string").map(file => toPosix(path.resolve(config.root, file))));
}

async function compilePacks(options: Required<PluginOptions>) {
	const outDir = path.resolve(process.cwd(), options.outputDirectory);
	log(`Cleaning ${outDir}...`);
	if (fs.existsSync(outDir)) {
		const filesToClean = (fs.readdirSync(outDir)).map(dirName => path.resolve(outDir, dirName));
		for (const file of filesToClean) {
			fs.rmSync(file, { recursive: true });
		}
	} else {
		fs.mkdirSync(outDir, { recursive: true });
	}

	async function compileMultiple(packFolders: fs.Dirent[], previous: string) {
		for (const pack of packFolders) {
			if (pack.isDirectory() && pack.name !== "_deleted") {
				const filepath = path.resolve(previous, pack.name);
				const files = fs.readdirSync(filepath, { withFileTypes: true });

				const output = path.resolve(outDir, pack.name);
				if (!fs.existsSync(output)) {
					fs.mkdirSync(output, { recursive: true });
				}
				const yaml = files.some(x => x.name.endsWith(".yml") || x.name.endsWith(".yaml"));
				await compilePack(filepath, output, { yaml, recursive: true });
			}
		}
	}

	log(`Compiling to ${outDir}...`);
	try {
		const packFolders = fs.readdirSync(options.dataDirectory, { withFileTypes: true });
		await compileMultiple(packFolders, options.dataDirectory);
	} catch {
		console.warn(`The given data directory (${options.dataDirectory}) does not exist!`);
	}
}

/**
 * Creates a FoundryVTT compendium sync plugin using unplugin.
 *
 * @param moduleJSON The module.json data. Best imported raw.
 * @param moduleJSON.id The module ID.
 * @param _options Where to store, compile, and how to transform data.
 */
export function createPlugin(moduleJSON: { id: string }, _options: PluginOptions = {}) {
	const options = {
		...defaultOptions,
		..._options,
		extractOptions: { ...defaultOptions.extractOptions, ..._options.extractOptions },
	} as Required<PluginOptions>;

	let isDevServer = false;
	let entries = new Set<string>();
	let fallbackEntry: string | undefined;

	return createUnplugin(() => ({
		name: "foundryvtt-sync",

		// Cross-bundler: Build hook for pack compilation
		// Should NOT be ran on dev server.
		async buildStart() {
			if (isDevServer) return;
			await compilePacks(options);
		},

		// Vite-specific extensions for dev server
		vite: {
			configResolved(config: ResolvedConfig) {
				entries = entryFiles(config);
			},

			configureServer(server: ViteDevServer) {
				isDevServer = !!server;
				setupLiveSync(server, moduleJSON.id, options);
			},

			resolveId(id: string) {
				return id === CLIENT_ID ? RESOLVED_CLIENT_ID : undefined;
			},

			load(id: string) {
				if (id !== RESOLVED_CLIENT_ID) return;
				const code = fs.readFileSync(CLIENT_FILE, "utf8").replace(/^\/\/# sourceMappingURL=.*$/m, "");
				const config = { id: moduleJSON.id, folders: !!options.extractOptions.folders };
				return `${code}\ncompendiumSync(${JSON.stringify(config)});\n`;
			},

			// Adds the live sync client (and its toggle) to the module's entry, only while the dev server runs.
			transform(code: string, id: string, transformOptions?: { ssr?: boolean }) {
				if (!isDevServer || transformOptions?.ssr) return;
				const file = id.split("?")[0];
				if (entries.size ? !entries.has(file) : !isFallbackEntry(file)) return;
				return { code: `${code}\nimport "${CLIENT_ID}";\n`, map: null };
			},
		},
	}));

	/** Without a configured entry, the first script the dev server transforms is the one Foundry requested. */
	function isFallbackEntry(file: string) {
		if (!/\.(?:[cm]?[jt]sx?|svelte|vue)$/.test(file) || file.includes("/node_modules/") || file.startsWith("\0")) return false;
		fallbackEntry ??= file;
		return fallbackEntry === file;
	}
}

export type UnpluginInstance = ReturnType<typeof createPlugin>;
