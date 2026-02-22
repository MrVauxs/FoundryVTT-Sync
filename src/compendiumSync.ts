/* eslint-disable no-console */

import type CompendiumCollection from "@7h3laughingman/foundry-types/client/documents/collections/compendium-collection.mjs";
import type { Document } from "@7h3laughingman/foundry-types/common/abstract/_module.mjs";

interface CreateOptions {
	data: (Record<string, any>)[];
	modifiedTime: number;
	pack: string;
}

interface UpdateOptions {
	diff: boolean;
	modifiedTime: number;
	pack: string;
	updates: (Record<string, any> & { _id: string })[];
}

interface DeleteOptions {
	deleteAll: boolean;
	ids: string[];
	pack: string;
}

function documentExportToCLI(rootDoc: Document) {
	const json = rootDoc.toJSON();

	json._key = `!${rootDoc.collectionName}!${rootDoc.id}`;
	recursiveKeys(rootDoc);

	// document: { items: [ { effects: [] } ] }
	function recursiveKeys(
		document: Document,
		collectionList: string[] = [rootDoc.collectionName],
		idList: string[] = [rootDoc.id],
	) {
		Object.keys(document.collections).forEach((key) => {
			const value = document.collections[key].contents.map((embed) => {
				const json = embed.toJSON();
				const localColList = [...collectionList, embed.collectionName];
				const localIDList = [...idList, embed.id];

				json._key = `!${localColList.join(".")}!${localIDList.join(".")}`;

				if (embed.collections) recursiveKeys(embed, collectionList);

				return json as ReturnType<Document["toJSON"]>;
			});

			json[key] = value;
		});
	}

	return json;
}

export function addHooks(hooks: Record<string, number>) {
	const { id: moduleID } = __VTT_SYNC_MODULE__;
	console.groupCollapsed("[foundryvtt-sync] Mounting hooks...");

	for (const documentType of CONST.COMPENDIUM_DOCUMENT_TYPES) {
		for (const embed of
			// @ts-expect-error Missing Types
			Object.values(CONFIG[documentType].documentClass.schema.fields)
				.filter(x => x instanceof foundry.data.fields.EmbeddedCollectionField)
				.map(x => x.element.documentName as string)
		) {
			function getRootDocument(document: Document) {
				if (!document.pack || !document.pack.startsWith(moduleID)) return;

				let parent: Document | null = document;
				if (!parent.parent) return false; // If we are already at the top, let the updateCompendium hook handle that.

				let highestParent: Document | null = null;
				while (parent) {
					parent = parent.parent;
					if (parent) highestParent = parent;
				}

				if (highestParent) {
					console.log(`[foundryvtt-sync] Sending update to parent compendium...\n\t${highestParent.uuid}`);
					return highestParent;
				} else {
					ui.notifications.error(`[foundryvtt-sync] Could not find a parent for document!</p>${document.uuid}`);
					return false;
				};
			}

			hooks[`create${embed}`] = Hooks.on(`create${embed}`, (document) => {
				const root = getRootDocument(document);
				if (!root) return;
				const compendium = game.packs.get(root.pack as string);
				if (!compendium) return;
				import.meta.hot?.send(
					"foundryvtt-compendium-sync:vtt-update",
					{
						json: documentExportToCLI(root),
						dir: compendium.metadata.name,
					},
				);
			});
			hooks[`update${embed}`] = Hooks.on(`update${embed}`, (document) => {
				const root = getRootDocument(document);
				if (!root) return;
				const compendium = game.packs.get(root.pack as string);
				if (!compendium) return;
				import.meta.hot?.send(
					"foundryvtt-compendium-sync:vtt-update",
					{
						json: documentExportToCLI(root),
						dir: compendium.metadata.name,
					},
				);
			});
			hooks[`delete${embed}`] = Hooks.on(`delete${embed}`, (document) => {
				console.log(document);
			});
		}
	}

	hooks.updateCompendium = Hooks.on("updateCompendium", (_collection: CompendiumCollection & { pack: CompendiumCollection }, _data: any, _options: CreateOptions | UpdateOptions | DeleteOptions) => {
		// Check if _collection isn't the CompendiumFolderCollection instance.
		// @ts-expect-error No Types Yet
		if ((_collection instanceof CompendiumFolderCollection)) _collection.metadata = _collection.pack.metadata;

		if (_collection?.metadata?.packageName !== moduleID) return;

		const dir = _collection.metadata.name;

		if ("data" in _options) {
			_options.data.forEach((doc) => {
				const document = _collection.get(doc._id);
				console.log("A Document has been created.", document);

				if (!document) throw new Error("Document not found!?");

				import.meta.hot?.send(
					"foundryvtt-compendium-sync:vtt-update",
					{
						json: documentExportToCLI(document),
						dir,
					},
				);
			});
		}

		if ("updates" in _options) {
			_options.updates.forEach((update) => {
				const document = _collection.get(update._id);
				console.log("A Document has been updated.", document);

				if (!document) throw new Error("Document not found!?");

				import.meta.hot?.send(
					"foundryvtt-compendium-sync:vtt-update",
					{
						json: documentExportToCLI(document),
						dir,
					},
				);
			});
		}

		if ("deleteAll" in _options) {
			_options.ids.forEach((id) => {
				console.log("A Document has been deleted.", id);

				import.meta.hot?.send(
					"foundryvtt-compendium-sync:vtt-delete",
					{ id, dir },
				);
			});
		}
	});
	console.groupEnd();
};

export default function compendiumSync() {
	if (import.meta.hot) {
		const { id: moduleID } = __VTT_SYNC_MODULE__;

		const hooks: Record<string, number> = {
			ready: Hooks.on("ready", () => {
				// #region Libwrapper
				// https://github.com/foundryvtt/foundryvtt/issues/12134
				if (!game.modules.get("lib-wrapper")?.active && game.user.isGM) {
					ui.notifications.error("Compendium Sync requires the 'libWrapper' module in order to sync Compendium Folders.");
				} else {
					libWrapper.register(
						moduleID,
						"CompendiumFolderCollection.prototype._onModifyContents",
						function (_action, documents, _result, operation, user) {
							Hooks.callAll("updateCompendium", this, documents, operation, user.id);
						},
						"LISTENER",
					);
				}
				// #endregion

				const compendia = game.packs.filter(c => c.metadata.packageName === moduleID) as (CompendiumCollection & { folders: Folder[] })[];

				if (compendia.length) {
					foundry.applications.api.DialogV2.confirm({
						window: { title: "foundryvtt-sync" },
						content: `<div><p>Sync <b>${compendia.length}</b> <code style="display: inline-block; padding: 3px">${moduleID}</code> compendiums to the file system?</p><ol style="columns: 2; margin: 0.5rem 0 0 0;">${compendia.map(c => `<li>${c.metadata.name}`).join("</li>")}</ol></div>`,
						yes: {
							default: false,
							callback: async () => {
								compendia.forEach(async (compendium) => {
									const documents = await compendium.getDocuments();
									[...documents, ...compendium.folders].forEach((doc) => {
										import.meta.hot?.send(
											"foundryvtt-compendium-sync:vtt-update",
											{
												json: documentExportToCLI(doc),
												dir: compendium.metadata.name,
											},
										);
									});
								});
							},
						},
						no: {
							default: true,
						},
					});

					addHooks(hooks);
					ui.notifications.info("Compendium Sync is now active.");
				} else {
					ui.notifications.warn("foundryvtt-sync: Could not find compendiums matching the module ID.");
				}
			}),
		};

		// HMR
		import.meta.hot?.dispose(() => {
			console.groupCollapsed(`[foundryvtt-sync] Unmounting ${Object.keys(hooks).length} hooks...`);
			Object.entries(hooks).forEach(([k, v]) => Hooks.off(k, v));
			console.groupEnd();
		});
		import.meta.hot?.accept((newModule) => {
			if (newModule) {
				newModule.addHooks(hooks);
			}
		});

		// Messages
		import.meta.hot?.on(
			"foundryvtt-compendium-sync:vtt-update:response",
			({ data: { json } }) => console.log(`Received and saved ${json.name} (${json._id})`),
		);

		import.meta.hot?.on("foundryvtt-compendium-sync:system-update", async ({ json, timestamp, file }) => {
			const data = JSON.parse(json);
			let document: Document | null | undefined;

			if (data._stats.compendiumSource) document = await fromUuid(data._stats.compendiumSource);
			if (!document) document = await fromUuid(`Compendium.${moduleID}.${file.split("/")[1]}.${data._id}`);

			if (!document) throw new Error("Could not find document to update!");

			const foundryJSON = JSON.stringify(document.toJSON()).replaceAll(/"modifiedTime":\d+/g, "");
			const incomingJSON = json.replaceAll(/"modifiedTime":\d+/g, "").replaceAll(/(,?)"_key":(\s?)".+?"/g, "");

			if (foundryJSON !== incomingJSON) await document.update(data, { modifiedTime: timestamp });
		});
	}
}
