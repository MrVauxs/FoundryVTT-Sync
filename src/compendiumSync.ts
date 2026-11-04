// Browser half of live sync. While the Vite dev server runs, the plugin serves this file as a virtual module and calls
// compendiumSync() from the module's entry, so it must not import anything at runtime.

export interface CompendiumSyncConfig {
	/** The module whose compendiums are synced. */
	id: string;
	/** Whether files are laid out in folders (`extractOptions.folders`), so a folder rename moves everything inside it. */
	folders?: boolean;
}

interface FileMessage {
	pack: string;
	file: string;
	key: string;
	data: Record<string, any>;
}

/** Operation option marking changes that came from a file, so they are not written straight back to it. */
const FROM_FILE = "foundryvttSyncFromFile";

/** Source data with the `_key` foundryvtt-cli uses to store each level of a document. */
function toSource(doc: any) {
	const data = doc.toObject();
	addKeys(data, doc.constructor, [doc.collectionName], [doc.id]);
	return data;
}

function addKeys(data: any, documentClass: any, collections: string[], ids: string[]) {
	data._key = `!${collections.join(".")}!${ids.join(".")}`;
	for (const [name, field] of Object.entries<any>(documentClass.hierarchy ?? {})) {
		const value = data[name];
		for (const child of Array.isArray(value) ? value : value ? [value] : []) {
			addKeys(child, field.model, [...collections, name], [...ids, child._id]);
		}
	}
}

/** `foundry.utils.equals` replaced `objectsEqual` in Foundry 14. */
function equals(a: unknown, b: unknown): boolean {
	const utils = foundry.utils as any;
	return (utils.equals ?? utils.objectsEqual)(a, b);
}

/** `_stats` changes on every save and is managed by Foundry, so it is left out of comparisons and updates. */
function withoutStats(data: unknown) {
	if (data === undefined) return undefined;
	return JSON.parse(JSON.stringify(data, (key, value) => key === "_stats" ? undefined : value));
}

/**
 * Validates changes the way Document#update does. Checking first keeps a half-finished edit from showing Foundry's own
 * error on every save; the caller reports it once.
 */
function validate(doc: any, changes: Record<string, unknown>) {
	const cleaned = doc.constructor.cleanData(foundry.utils.deepClone(changes), { migrate: true, sanitize: true, partial: true }, { creation: false, model: doc, source: doc._source });
	doc.updateSource(cleaned, { clean: true, dryRun: true, fallback: false, recursive: false });
}

/** The top-level fields of `data` that differ from `current`, leaving out `_id` and `_stats`. */
function changedFields(current: Record<string, any>, data: Record<string, any>) {
	const incoming = withoutStats(data);
	return Object.keys(data).filter(key => key !== "_id" && key !== "_stats" && !equals(withoutStats(current[key]), incoming[key]));
}

/**
 * Marks each field to be replaced instead of merged, so keys removed from the file are removed in Foundry. This is
 * per field rather than `recursive: false`: that option also replaces `_stats` with the few stats the server sends
 * back, wiping `createdTime` and `compendiumSource` from the document in the browser.
 */
function replace(changes: Record<string, unknown>) {
	const ForcedReplacement = (foundry.data as any).operators?.ForcedReplacement; // Foundry 14
	return Object.fromEntries(Object.entries(changes).map(([key, value]) => {
		if (key === "_id" || value === null || typeof value !== "object") return [key, value];
		return ForcedReplacement ? [key, ForcedReplacement.create(value)] : [`==${key}`, value];
	}));
}

/**
 * Makes a document match its file, touching only what changed. Embedded documents that were only edited are updated
 * in place. If the file adds or removes embedded documents, that collection is replaced as a whole, which skips the
 * system's create and delete side effects (such as pf2e granting items). Returns whether anything changed.
 */
async function updateFromFile(doc: any, data: Record<string, any>): Promise<boolean> {
	const current = doc.toObject();
	const changes: Record<string, unknown> = {};
	const embeddedUpdates: [string, Record<string, unknown>[]][] = [];

	for (const key of changedFields(current, data)) {
		const field: any = doc.constructor.hierarchy?.[key];
		const before: any[] = current[key];
		const after: any[] = data[key];
		const sameDocuments = field instanceof foundry.data.fields.EmbeddedCollectionField
			&& Array.isArray(before) && Array.isArray(after) && before.length === after.length
			&& after.every(entry => before.some(prior => prior._id === entry._id));
		if (!sameDocuments) {
			changes[key] = after;
			continue;
		}
		const updates = after.flatMap((entry) => {
			const prior = before.find(p => p._id === entry._id);
			const keys = changedFields(prior, entry);
			return keys.length ? [Object.fromEntries([["_id", entry._id], ...keys.map(k => [k, entry[k]])])] : [];
		});
		embeddedUpdates.push([(field.model as any).documentName, updates]);
	}
	if (foundry.utils.isEmpty(changes) && !embeddedUpdates.some(([, updates]) => updates.length)) return false;

	validate(doc, changes);
	for (const [name, updates] of embeddedUpdates) {
		for (const update of updates) validate(doc.getEmbeddedDocument(name, update._id), update);
	}

	if (!foundry.utils.isEmpty(changes)) await doc.update(replace(changes), { [FROM_FILE]: true });
	for (const [name, updates] of embeddedUpdates) {
		if (updates.length) await doc.updateEmbeddedDocuments(name, updates.map(replace), { [FROM_FILE]: true });
	}
	return true;
}

export default function compendiumSync({ id: moduleId, folders = false }: CompendiumSyncConfig) {
	const hot = import.meta.hot;
	if (!hot) return;

	let enabled = false;
	let button: HTMLButtonElement | undefined;
	/** The last error shown for each file, so a broken edit is reported once rather than on every save. */
	const fileErrors = new Map<string, string>();

	const modulePacks = (): any[] => (game.packs as any).filter((pack: any) =>
		pack.metadata.packageType === "module" && pack.metadata.packageName === moduleId);
	/** The data directory folder a pack is built from: `packs/<name>` is compiled from `data/<name>`. */
	const dirOf = (pack: any): string => String(pack.metadata.path ?? pack.metadata.name).split(/[\\/]/).pop()!.replace(/\.db$/, "");

	function render() {
		if (!button) return;
		const label = `Live Sync (${moduleId}): ${enabled ? "On" : "Off"}`;
		button.setAttribute("aria-pressed", String(enabled));
		button.setAttribute("aria-label", label);
		button.dataset.tooltip = label;
	}

	function setEnabled(value: boolean, reason?: string) {
		const packs = modulePacks();
		if (value && !packs.length) {
			ui.notifications.warn(`Live sync: ${moduleId} has no compendiums to sync.`);
			return;
		}
		enabled = value;
		fileErrors.clear();
		render();
		hot!.send("foundryvtt-sync:toggle", { enabled, user: game.user.name });
		if (!enabled) {
			ui.notifications.info(reason ?? "Live sync is off.");
			return;
		}
		ui.notifications.info(`Live sync is on for ${packs.length} ${moduleId} compendium${packs.length === 1 ? "" : "s"}.`);
		const locked = packs.filter(pack => pack.locked);
		if (locked.length) {
			ui.notifications.warn(`Live sync: unlock ${locked.map(pack => pack.title).join(", ")} to edit and sync ${locked.length === 1 ? "it" : "them"}.`);
		}
	}

	function report(file: string, level: "info" | "warn" | "error", message: string) {
		hot!.send("foundryvtt-sync:result", { file, level, message });
	}

	function fail(file: string, message: string) {
		if (fileErrors.get(file) === message) return;
		fileErrors.set(file, message);
		// The report puts it in the dev server terminal, so it isn't also logged to the browser console (which Vite 8 forwards there too).
		ui.notifications.warn(`Live sync: ${file}: ${message.split("] ").pop()}`, { console: false });
		report(file, "warn", message);
	}

	/** Sends documents changed in Foundry to the dev server, which writes them to the data directory. */
	async function syncToFiles(pack: any, documents: any[], operation: any) {
		const writes = new Map<string, any>();
		const deleted: string[] = [];
		for (const doc of documents) {
			const isFolder = doc.documentName === "Folder";
			if (!(isFolder ? pack.folders.has(doc.id) : pack.index.has(doc.id))) {
				deleted.push(`!${doc.collectionName}!${doc.id}`);
				continue;
			}
			writes.set(doc.uuid, doc);

			// With `folders`, a folder's name and parent are part of the path of everything inside it.
			if (isFolder && folders && operation?.action === "update") {
				const subfolders: any[] = doc.getSubfolders(true);
				for (const folder of subfolders) writes.set(folder.uuid, folder);
				const ids = new Set([doc.id, ...subfolders.map(folder => folder.id)]);
				for (const entry of await pack.getDocuments()) {
					if (ids.has(entry.folder?.id)) writes.set(entry.uuid, entry);
				}
			}
		}

		const dir = dirOf(pack);
		if (writes.size) {
			hot!.send("foundryvtt-sync:write", {
				pack: dir,
				documents: [...writes.values()].map(toSource),
				folders: folders ? pack.folders.contents.map(toSource) : undefined,
			});
		}
		if (deleted.length) hot!.send("foundryvtt-sync:delete", { pack: dir, keys: deleted });
	}

	/** Applies a file the dev server saw change to its compendium document. */
	async function applyFile({ pack: dir, file, key, data }: FileMessage) {
		if (!enabled) return;
		const pack = modulePacks().find(pack => dirOf(pack) === dir);
		if (!pack) {
			report(file, "warn", `no ${moduleId} compendium is built from ${dir}/, so the change was not applied.`);
			return;
		}
		if (pack.locked) {
			fail(file, `${pack.title} is locked. Unlock it, then save the file again.`);
			return;
		}

		const [, collection, id] = key.split("!");
		const isFolder = collection === "folders";
		const documentClass = isFolder ? CONFIG.Folder.documentClass : pack.documentClass;
		const doc = isFolder ? pack.folders.get(id) : await pack.getDocument(id);
		try {
			if (doc) {
				if (await updateFromFile(doc, data)) report(file, "info", `updated ${doc.documentName} "${doc.name}"`);
			} else {
				// eslint-disable-next-line no-new, new-cap
				new documentClass(foundry.utils.deepClone(data), { pack: pack.collection, strict: true }); // Throws on invalid data.
				const created = await documentClass.create(data, { pack: pack.collection, keepId: true, [FROM_FILE]: true });
				if (!created) throw new Error("Foundry did not create the document.");
				report(file, "info", `created ${created.documentName} "${created.name}"`);
			}
			fileErrors.delete(file);
		} catch (err) {
			fail(file, err instanceof Error ? err.message : String(err));
		}
	}

	Hooks.once("ready", () => {
		if (!game.user.isGM) return;
		button = document.createElement("button");
		button.type = "button";
		button.id = "foundryvtt-sync-toggle";
		button.className = "ui-control toggle icon fa-solid fa-arrows-rotate";
		// #ui-right-column-1 is the column left of the sidebar; order puts the button below the chat notifications.
		Object.assign(button.style, { order: "100", alignSelf: "flex-end" });
		button.addEventListener("click", () => setEnabled(!enabled));
		document.getElementById("ui-right-column-1")?.append(button);
		render();
	});

	Hooks.on("updateCompendium", (pack: any, documents: any[], operation: any) => {
		if (!enabled || operation?.[FROM_FILE]) return;
		if (pack.metadata.packageType !== "module" || pack.metadata.packageName !== moduleId) return;
		syncToFiles(pack, documents, operation).catch(err => console.error("[foundryvtt-sync]", err));
	});

	hot.on("foundryvtt-sync:file", (message: FileMessage) => {
		applyFile(message).catch(err => console.error("[foundryvtt-sync]", err));
	});

	hot.on("vite:ws:disconnect", () => {
		if (enabled) setEnabled(false, "Live sync is off: the Vite dev server stopped.");
	});
}
