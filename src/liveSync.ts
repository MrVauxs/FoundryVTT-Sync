import type { ExtractOptions } from "@foundryvtt/foundryvtt-cli";
import type { ViteDevServer, WebSocketClient } from "vite";
import type { PluginOptions } from "./plugin.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compilePack, extractPack } from "@foundryvtt/foundryvtt-cli";
import chalk from "chalk";
import YAML from "js-yaml";

/** The `extractPack` options live sync can mirror. The rest only make sense for a full extraction. */
export type LiveSyncExtractOptions = Omit<ExtractOptions, "clean" | "nedb" | "log" | "documentType" | "collection">;

/** Source document as sent by the client: `toObject()` data with a CLI `_key` on every level. */
type SourceData = Record<string, any> & { _key: string };

interface WriteMessage {
	pack: string;
	documents: SourceData[];
	folders?: SourceData[];
}

interface DeleteMessage {
	pack: string;
	keys: string[];
}

interface ResultMessage {
	file: string;
	level: "info" | "warn" | "error";
	message: string;
}

/** Collections an Adventure keeps inline, which `expandAdventures` writes out as separate files (mirrors foundryvtt-cli). */
const ADVENTURE_DOCS = ["actors", "cards", "combats", "folders", "items", "journal", "playlists", "scenes", "tables", "macros"];

/** `_stats` fields foundryvtt-cli's `omitVolatile` ignores when comparing an entry against the existing file. */
const VOLATILE_FIELDS = ["createdTime", "modifiedTime", "lastModifiedBy", "systemVersion", "coreVersion"];

/** How long a file has to stay quiet before it is read, so a burst of editor writes becomes one update. */
const FILE_DEBOUNCE_MS = 200;

const isSourceFile = (file: string) => /\.(?:json|ya?ml)$/i.test(file);
const isYaml = (file: string) => /\.ya?ml$/i.test(file);
const parse = (content: string, file: string): any => isYaml(file) ? YAML.load(content) : JSON.parse(content);
const display = (file: string) => path.relative(process.cwd(), file).replaceAll("\\", "/");

function isObject(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every source file below `dir`, skipping `_deleted` folders. */
function walk(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const file = path.join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === "_deleted" ? [] : walk(file);
		return entry.isFile() && isSourceFile(file) ? [file] : [];
	});
}

/** Removes `_key` from every level, since it is a foundryvtt-cli field and not part of any Document. */
function stripKeys(value: unknown) {
	if (Array.isArray(value)) {
		value.forEach(stripKeys);
	} else if (isObject(value)) {
		delete value._key;
		Object.values(value).forEach(stripKeys);
	}
}

/** Files an expanded Adventure refers to, resolved the same way foundryvtt-cli does when compiling. */
function adventureRefs(file: string, data: Record<string, any>): string[] {
	return ADVENTURE_DOCS.flatMap(name => (data[name] ?? [])
		.filter((entry: unknown) => typeof entry === "string")
		.map((entry: string) => path.join(path.dirname(file), entry)));
}

function isDocument(value: unknown): value is Record<string, any> {
	return isObject(value) && typeof value._id === "string" && isObject(value._stats);
}

/** A document's own data: without volatile stats, and with its embedded documents reduced to their IDs. */
function ownData(doc: Record<string, any>) {
	return JSON.stringify(doc, (key, value) => {
		if (key !== "" && isDocument(value)) return value._id;
		if (key !== "_stats" || !isObject(value)) return value;
		return Object.fromEntries(Object.entries(value).filter(([k]) => !VOLATILE_FIELDS.includes(k)));
	});
}

/**
 * Keeps `_stats` values from the existing file where Foundry's copy is noise, for the document and each embedded one:
 * - `compendiumSource` pointing at the document itself. A document is not its own source; systems such as pf2e set
 *   that in memory when loading compendium documents, and writing it would replace the real source in the file.
 * - With `volatile` (foundryvtt-cli's `omitVolatile`), the volatile stats of documents whose own data did not change.
 *   Otherwise an update that touches one embedded document rewrites the timestamps of all of them.
 * Returns whether `next` changed.
 */
function keepFileStats(next: unknown, prev: unknown, { moduleId, volatile }: { moduleId: string; volatile: boolean }): boolean {
	if (!isDocument(next) || !isDocument(prev)) return false;
	let changed = false;
	const source = next._stats.compendiumSource;
	if (typeof source === "string" && source.startsWith(`Compendium.${moduleId}.`) && source.endsWith(`.${next._id}`)
		&& "compendiumSource" in prev._stats && prev._stats.compendiumSource !== source) {
		next._stats.compendiumSource = prev._stats.compendiumSource;
		changed = true;
	}
	if (volatile && ownData(next) === ownData(prev)) {
		for (const field of VOLATILE_FIELDS) {
			if (!(field in prev._stats) || next._stats[field] === prev._stats[field]) continue;
			next._stats[field] = prev._stats[field];
			changed = true;
		}
	}
	for (const [key, value] of Object.entries(next)) {
		const before = prev[key];
		if (Array.isArray(value) && Array.isArray(before)) {
			for (const child of value) {
				changed = keepFileStats(child, before.find(entry => entry?._id === child?._id), { moduleId, volatile }) || changed;
			}
		} else {
			changed = keepFileStats(value, before, { moduleId, volatile }) || changed;
		}
	}
	return changed;
}

/**
 * Two-way sync between the module's compendiums in Foundry and its data directory, while the Vite dev server runs.
 * The browser side lives in `compendiumSync.ts`; it only talks to this server while its toggle is on.
 */
export function setupLiveSync(server: ViteDevServer, moduleId: string, options: Required<PluginOptions>) {
	const dataDir = path.resolve(process.cwd(), options.dataDirectory);
	const extractOptions: ExtractOptions = { ...options.extractOptions, clean: false, log: false, nedb: false };
	const { logger } = server.config;
	const prefix = chalk.hex("#FFA500")("[foundryvtt-sync]");
	const log = {
		info: (message: string) => logger.info(`${prefix} ${message}`, { timestamp: true }),
		warn: (message: string) => logger.warn(`${prefix} ${chalk.yellow(message)}`, { timestamp: true }),
		error: (message: string) => logger.error(`${prefix} ${chalk.red(message)}`, { timestamp: true }),
	};

	/** Browser tabs with the toggle on. */
	const clients = new Set<WebSocketClient>();
	/** Content this plugin last wrote to each file, so the watcher event caused by that write is not sent back. */
	const lastWritten = new Map<string, string>();
	/** Files that currently fail to parse, with the error, so each broken state is reported once. */
	const invalid = new Map<string, string>();
	const timers = new Map<string, NodeJS.Timeout>();
	/** Parsed `_key`s (and Adventure file references) per file, refreshed when a file's mtime or size changes. */
	const entries = new Map<string, { mtimeMs: number; size: number; key?: string; refs?: string[] }>();

	// Writes, deletions and file reads run one at a time, so a read never sees a half-applied write.
	let queue = Promise.resolve();
	function enqueue(task: () => Promise<void> | void) {
		queue = queue.then(task).catch(err => log.error(err instanceof Error ? (err.stack ?? err.message) : String(err)));
	}

	function activeClient() {
		for (const client of clients) {
			if ((client.socket as { readyState?: number } | undefined)?.readyState === 1) return client;
			clients.delete(client); // The tab was closed or reloaded.
		}
		return undefined;
	}

	function readEntry(file: string) {
		const { mtimeMs, size } = fs.statSync(file);
		const cached = entries.get(file);
		if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached;
		const entry: { mtimeMs: number; size: number; key?: string; refs?: string[] } = { mtimeMs, size };
		try {
			const data = parse(fs.readFileSync(file, "utf8"), file);
			if (typeof data?._key === "string") entry.key = data._key;
			if (entry.key?.startsWith("!adventures!")) entry.refs = adventureRefs(file, data);
		} catch { } // Unparseable files have no known key.
		entries.set(file, entry);
		return entry;
	}

	/** Maps each `_key` in a pack directory to its file, and each Adventure `_key` to the files it refers to. */
	function indexPack(packDir: string) {
		const files = new Map<string, string>();
		const refs = new Map<string, string[]>();
		for (const file of walk(packDir)) {
			const { key, refs: adventureFiles } = readEntry(file);
			if (!key) continue;
			files.set(key, file);
			if (adventureFiles) refs.set(key, adventureFiles);
		}
		return { files, refs };
	}

	/** Serializes a document the way foundryvtt-cli's extractPack does. */
	async function serialize(data: unknown, file: string) {
		const yaml = isYaml(file);
		const { replacer = null, space = 2 } = extractOptions.jsonOptions ?? {};
		const content = yaml ? YAML.dump(data, extractOptions.yamlOptions) : `${JSON.stringify(data, replacer as any, space)}\n`;
		return extractOptions.transformSerialized ? extractOptions.transformSerialized(content, { yaml, filename: file }) : content;
	}

	function writeFile(file: string, content: string) {
		lastWritten.set(file, content); // Before writing, as the watcher can fire before writeFileSync returns.
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, content);
	}

	/** Deletes directories left empty below a pack directory. */
	function pruneEmpty(dir: string, packDir: string) {
		while (dir.startsWith(packDir + path.sep) && fs.existsSync(dir) && !fs.readdirSync(dir).length) {
			fs.rmdirSync(dir);
			dir = path.dirname(dir);
		}
	}

	/**
	 * Writes documents changed in Foundry to the data directory. They are compiled into a temporary pack and
	 * extracted again with foundryvtt-cli, so file names, folders, Adventures and formatting match `extractPack`.
	 */
	async function writeFromFoundry({ pack, documents, folders = [] }: WriteMessage) {
		const packDir = path.join(dataDir, pack);
		const targets: SourceData[] = [];
		for (const doc of documents) {
			if (options.ignoreAdventureHMR && doc._key.startsWith("!adventures!")) continue;
			if (await options.transformer(doc) === false) {
				log.warn(`The transformer rejected "${doc.name}" (${doc._id}), so it was not written.`);
				continue;
			}
			targets.push(doc);
		}
		if (!targets.length) return;

		const targetKeys = new Set(targets.map(doc => doc._key));
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "foundryvtt-sync-"));
		try {
			const src = path.join(tmp, "src");
			const db = path.join(tmp, "db");
			const out = path.join(tmp, "out");
			fs.mkdirSync(src);
			// Folders are only context, so `folders: true` can work out where each document goes.
			const context = folders.filter(folder => !targetKeys.has(folder._key));
			[...targets, ...context].forEach((doc, i) => fs.writeFileSync(path.join(src, `${i}.json`), JSON.stringify(doc)));
			await compilePack(src, db);
			await extractPack(db, out, extractOptions);

			const index = indexPack(packDir);
			const produced = new Set<string>();
			const newFiles = new Map<string, string>();
			for (const extracted of walk(out)) {
				const file = path.join(packDir, path.relative(out, extracted));
				let content = fs.readFileSync(extracted, "utf8");
				let data: any;
				try {
					data = parse(content, extracted);
				} catch { } // A custom transformSerialized may produce something we can't read back.
				const key: string | undefined = typeof data?._key === "string" ? data._key : undefined;

				// Context folders are written only when the pack has no file for them yet.
				if (key && !targetKeys.has(key) && index.files.has(key)) continue;
				produced.add(file);
				if (key) newFiles.set(key, file);

				// The file this document had so far: the same path, or the old one if it was renamed or moved.
				const previousFile = fs.existsSync(file) ? file : key ? index.files.get(key) : undefined;
				if (previousFile) {
					const current = fs.readFileSync(previousFile, "utf8");
					if (previousFile === file && current === content) continue;
					let previous: unknown;
					try {
						previous = parse(current, previousFile);
					} catch { } // A broken file is simply replaced.
					if (keepFileStats(data, previous, { moduleId, volatile: !!extractOptions.omitVolatile })) {
						content = await serialize(data, file);
					}
					if (previousFile === file && current === content) continue;
				}
				writeFile(file, content);
				if (key && targetKeys.has(key)) {
					const old = index.files.get(key);
					const moved = old && old !== file ? ` (was ${display(old)})` : "";
					log.info(`Foundry → ${display(file)}${moved}`);
				}
			}

			// A rename or a move to another folder leaves the previous file behind; remove it.
			for (const key of targetKeys) {
				const stale = [index.files.get(key), ...(index.refs.get(key) ?? [])]
					.filter((file): file is string => !!file && newFiles.has(key) && !produced.has(file));
				for (const file of stale) {
					fs.rmSync(file, { force: true });
					pruneEmpty(path.dirname(file), packDir);
				}
			}
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 });
		}
	}

	/** Moves the files of documents deleted in Foundry to `<dataDirectory>/_deleted/<pack>/`, which is never compiled. */
	function deleteFromFoundry({ pack, keys }: DeleteMessage) {
		const packDir = path.join(dataDir, pack);
		const index = indexPack(packDir);
		for (const key of keys) {
			const file = index.files.get(key);
			if (!file) continue;
			if (options.ignoreAdventureHMR && key.startsWith("!adventures!")) continue;
			for (const source of [file, ...(index.refs.get(key) ?? [])]) {
				if (!fs.existsSync(source)) continue;
				const target = path.join(dataDir, "_deleted", path.relative(dataDir, source));
				fs.mkdirSync(path.dirname(target), { recursive: true });
				fs.renameSync(source, target);
				pruneEmpty(path.dirname(source), packDir);
			}
			log.info(`Foundry deleted ${display(file)}, moved to ${display(path.join(dataDir, "_deleted", pack))}/`);
		}
	}

	/** Reads a changed file and sends the document it belongs to to the browser. */
	function readFromFile(file: string) {
		const client = activeClient();
		if (!client) return;

		let content: string;
		try {
			content = fs.readFileSync(file, "utf8");
		} catch {
			return; // Deleted or renamed before the debounce ran out.
		}
		if (lastWritten.get(file) === content) return; // The change was this plugin's own write.
		lastWritten.delete(file);

		const pack = path.relative(dataDir, file).split(path.sep)[0];
		const packDir = path.join(dataDir, pack);
		let root: any;
		let rootFile = file;
		try {
			const data = parse(content, file);
			if (!isObject(data)) throw new Error("The file does not contain an object.");
			root = data;
			// Expanded Adventures: a file without a `_key` is an Adventure entry, and an Adventure is synced as a whole.
			if (typeof data._key !== "string") {
				const index = indexPack(packDir);
				const adventure = [...index.refs].find(([, files]) => files.includes(file));
				if (!adventure) return; // Not a document, e.g. a config file.
				rootFile = index.files.get(adventure[0])!;
				root = parse(fs.readFileSync(rootFile, "utf8"), rootFile);
			}
			if (typeof root._key === "string" && root._key.startsWith("!adventures!")) {
				for (const name of ADVENTURE_DOCS) {
					root[name] = (root[name] ?? []).map((entry: unknown) => {
						if (typeof entry !== "string") return entry;
						const entryFile = path.join(path.dirname(rootFile), entry);
						return parse(fs.readFileSync(entryFile, "utf8"), entryFile);
					});
				}
			}
		} catch (err) {
			const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
			if (invalid.get(file) !== reason) {
				invalid.set(file, reason);
				log.warn(`${display(file)} can't be read yet, so it is not synced (${reason}). Waiting for the next save.`);
			}
			return;
		}
		if (invalid.delete(file)) log.info(`${display(file)} can be read again.`);

		const key = root._key;
		const [, collection] = typeof key === "string" ? key.split("!") : [];
		if (!collection || collection.includes(".")) return; // Only primary documents are stored as files.
		if (options.ignoreAdventureHMR && collection === "adventures") return;
		stripKeys(root);
		client.send("foundryvtt-sync:file", { pack, file: display(file), key, data: root });
	}

	function onFileEvent(file: string) {
		file = path.resolve(file);
		const relative = path.relative(dataDir, file);
		const parts = relative.split(path.sep);
		if (relative.startsWith("..") || path.isAbsolute(relative) || parts.length < 2) return; // Outside of a pack folder.
		if (parts.includes("_deleted") || !isSourceFile(file) || !activeClient()) return;
		clearTimeout(timers.get(file));
		timers.set(file, setTimeout(() => {
			timers.delete(file);
			enqueue(() => readFromFile(file));
		}, FILE_DEBOUNCE_MS));
	}

	server.watcher.add(dataDir);
	server.watcher.on("add", onFileEvent);
	server.watcher.on("change", onFileEvent);

	server.ws.on("foundryvtt-sync:toggle", ({ enabled, user }: { enabled: boolean; user?: string }, client: WebSocketClient) => {
		if (enabled) clients.add(client);
		else clients.delete(client);
		const by = user ? ` (${user})` : "";
		log.info(enabled ? `Live sync ${chalk.green("on")}${by}, watching ${display(dataDir)}/` : `Live sync ${chalk.gray("off")}${by}`);
	});
	server.ws.on("foundryvtt-sync:write", (data: WriteMessage) => enqueue(() => writeFromFoundry(data)));
	server.ws.on("foundryvtt-sync:delete", (data: DeleteMessage) => enqueue(() => deleteFromFoundry(data)));
	server.ws.on("foundryvtt-sync:result", ({ file, level, message }: ResultMessage) => {
		log[level](`${file} → Foundry: ${message}`);
	});
}
