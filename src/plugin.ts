import type Document from "@7h3laughingman/foundry-types/common/abstract/document.mjs";
import type { ViteDevServer } from "vite";
import fs from "node:fs";
import { EOL } from "node:os";
import path from "node:path";
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import { createUnplugin } from "unplugin";
import { log } from "./logs.js";

/**
 * @prop { dataDirectory } - The directory to watch for updates in. Defaults to "data".
 * @prop { outputDirectory } - The directory to write the pack files to. Defaults to "packs".
 * @prop { transformer } - A function that takes a Document["_source"] and returns a Promise<Document["_source"]> | Document["_source"] | Promise<false> | false. This is used to transform the data before it is written to the pack file. Defaults to no transformation.
 * @prop { ignoreAdventureHMR } - Whether to ignore hot updates for Adventure type documents. This is useful if you are using the expandAdventures option when building your packs, as the sync plugin does not yet support that option.
 */
export interface PluginOptions {
	dataDirectory?: string;
	outputDirectory?: string;
	transformer?: (doc: Document["_source"]) => Promise<void> | void | Promise<false> | false;
	ignoreAdventureHMR?: boolean;
}

const defaultOptions: Required<PluginOptions> = {
	dataDirectory: "data",
	outputDirectory: "packs",
	transformer: () => { },
	ignoreAdventureHMR: false,
} as const;

function getSafeFilename(filename: string) {
	// eslint-disable-next-line regexp/no-obscure-range
	return filename.replace(/[^a-zA-Z0-9А-я]/g, "_");
}

async function onUpdate(
	data: { json: Document["_source"]; dir: string },
	client: any,
	options: Required<PluginOptions>,
) {
	log(`Received an update: ${data.json.name}`);
	const name = data.json.name;

	if (options.ignoreAdventureHMR && data.json.type === "Adventure") {
		log(`Ignoring update for Adventure document: ${name}`);
		return;
	}

	if (options.transformer) {
		const denied = await options.transformer(data.json);
		if (denied === false) {
			console.warn(`Transformer returned a falsy value on "${name}"! No changes have been made.`);
			return;
		}
	}

	const { json, dir } = data;

	// Ensure the directory exists, create if not
	const targetDir = `${options.dataDirectory}/${dir}`;
	if (!fs.existsSync(targetDir)) {
		fs.mkdirSync(targetDir, { recursive: true });
	}

	// Get a list of existing file paths
	const existingFiles = fs.readdirSync(targetDir);
	const newFilePath = `${targetDir}/${getSafeFilename(json.name as string)}_${json._id}.json`;

	// Check if the JSON exists. If it doesn't, check for any previous versions of the same file and delete them.
	if (!fs.existsSync(newFilePath)) {
		for (const file of existingFiles) {
			const filePath = `${options.dataDirectory}/${dir}/${file}`;
			if (fs.lstatSync(filePath).isDirectory()) continue;
			const fileJson = JSON.parse(fs.readFileSync(filePath, "utf8"));

			// Check if the ID of the existing file matches with the incoming data's ID
			if (fileJson._id === json._id) {
				// If it does, delete the previous file
				fs.unlinkSync(filePath);
			}
		}
	}

	fs.writeFileSync(
		newFilePath,
		JSON.stringify(json, null, "\t"),
		"utf8",
	);

	fs.appendFileSync(newFilePath, EOL, "utf8");
	fs.appendFileSync(newFilePath, EOL, "utf8");

	client.send("foundryvtt-compendium-sync:vtt-update:response", { data });
}

function onDelete(id: string, dir: string, options: Required<PluginOptions>) {
	// Get a list of existing file paths
	const existingFiles = fs.readdirSync(`${options.dataDirectory}/${dir}`);

	for (const file of existingFiles) {
		const filePath = `${options.dataDirectory}/${dir}/${file}`;
		if (fs.lstatSync(filePath).isDirectory()) continue;
		const fileJson = JSON.parse(fs.readFileSync(filePath, "utf8"));

		// Check if the ID of the existing file matches with the incoming data's ID
		if (fileJson._id === id) {
			// Skip Adventure documents if ignoreAdventureHMR is enabled
			if (options.ignoreAdventureHMR && fileJson.type === "Adventure") {
				log(`Ignoring delete for Adventure document: ${fileJson.name}`);
				return;
			}
			// Create _deleted directory if it doesn't exist yet.
			if (!fs.existsSync(`${options.dataDirectory}/${dir}/_deleted`)) {
				fs.mkdirSync(`${options.dataDirectory}/${dir}/_deleted`);
			}
			try {
				// Move to _deleted/ for safekeeping.
				fs.renameSync(filePath, `${options.dataDirectory}/${dir}/_deleted/${file}`);
			} catch {
				console.error("Could not move file to _deleted directory. Remove manually!");
			}
		}
	}
}

function compilePacks(options: Required<PluginOptions>) {
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

				if (files.some(x => x.isDirectory() && x.name !== "_deleted")) {
					await compileMultiple(files, `${previous}/${pack.name}`);
				} else {
					const output = path.resolve(outDir, `${pack.name}`);
					if (!fs.existsSync(output)) {
						fs.mkdirSync(output, { recursive: true });
					}
					await compilePack(filepath, output);
				}
			}
		}
	}

	log(`Compiling to ${outDir}...`);
	try {
		const packFolders = fs.readdirSync(options.dataDirectory, { withFileTypes: true });
		compileMultiple(packFolders, options.dataDirectory);
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
	const options = { ...defaultOptions, ..._options } as Required<PluginOptions>;

	let hasInjectedCompendiumSync = false;

	return createUnplugin(() => ({
		name: "foundryvtt-sync",

		// Cross-bundler: Define globals
		define: {
			__VTT_SYNC_MODULE__: JSON.stringify(moduleJSON),
		},

		// Cross-bundler: Build hook for pack compilation
		buildStart() {
			compilePacks(options);
		},

		// Cross-bundler: Transform hook for code injection
		transform(code) {
			if (!hasInjectedCompendiumSync) {
				code += `\n\nimport compendiumSync from 'foundryvtt-sync/dist/compendiumSync';\ncompendiumSync()\n\n`;
				hasInjectedCompendiumSync = true;
				log("Injected compendium sync code.");
			}
			return code;
		},

		// Vite-specific extensions for dev server
		vite: {
			configureServer(server: ViteDevServer) {
				server.watcher.add([options.dataDirectory]);

				server.ws.on(
					"foundryvtt-compendium-sync:vtt-update",
					(data, client) => onUpdate(data, client, options),
				);

				server.ws.on(
					"foundryvtt-compendium-sync:vtt-delete",
					({ id, dir }) => onDelete(id, dir, options),
				);
			},

			handleHotUpdate(ctx) {
				if (
					ctx.file.startsWith(`${options.dataDirectory}/`)
					&& ctx.file.endsWith("json")
					&& !ctx.file.includes("/_deleted")
				) {
					setTimeout(async () => {
						const content = await ctx.read();
						try {
							const data = JSON.parse(content);
							ctx.server.ws.send({
								type: "custom",
								event: "foundryvtt-compendium-sync:system-update",
								data: { json: JSON.stringify(data), file: ctx.file, timestamp: ctx.timestamp },
							});
						} catch (err) {
							console.warn(err);
						}
					}, 500);
				}
			},
		},
	}));
}

export type UnpluginInstance = ReturnType<typeof createPlugin>;
