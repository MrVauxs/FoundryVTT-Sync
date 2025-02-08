import type Document from "foundry-pf2e/foundry/common/abstract/document.d.ts";

const { id: moduleID } = __VTT_SYNC_MODULE__;

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

/* eslint-disable no-console */
if (import.meta.hot) {
	const hooks = {
		ready: Hooks.on('ready', () => {
			// https://github.com/foundryvtt/foundryvtt/issues/12134
			if (!game.modules.get('lib-wrapper')?.active && game.user.isGM) {
				ui.notifications.error('Compendium Sync requires the \'libWrapper\' module in order to sync Compendium Folders.');
			} else {
				libWrapper.register(
					moduleID,
					'CompendiumFolderCollection.prototype._onModifyContents',
					function (_action, documents, _result, operation, user) {
						Hooks.callAll('updateCompendium', this, documents, operation, user.id);
					},
					'LISTENER',
				);
			}

			const compendia = game.packs.filter(c => c.metadata.packageName === moduleID) as (CompendiumCollection & { folders: Folder[] })[];
			console.log(`Found ${compendia.length} compendiums:`);
			compendia.forEach(async (compendium) => {
				const documents = await compendium.getDocuments();
				[...documents, ...compendium.folders].forEach((doc) => {
					const json = doc.toJSON();
					import.meta.hot?.send(
						'foundryvtt-compendium-sync:vtt-update',
						{ json, dir: compendium.metadata.name },
					);
				});
			});
		}),
		updateCompendium: Hooks.on('updateCompendium', (_collection: CompendiumCollection & { pack: CompendiumCollection }, _data: any, _options: CreateOptions | UpdateOptions | DeleteOptions) => {
			// Check if _collection isn't the CompendiumFolderCollection instance.
			// @ts-expect-error No Types Yet
			if ((_collection instanceof CompendiumFolderCollection)) _collection.metadata = _collection.pack.metadata;

			if (_collection?.metadata?.packageName !== moduleID) return;

			const dir = _collection.metadata.name;

			if ('data' in _options) {
				_options.data.forEach((doc) => {
					const document = _collection.get(doc._id);
					console.log('A Document has been created.', document);

					if (!document) throw new Error('Document not found!?');

					const json = document.toJSON();
					import.meta.hot?.send(
						'foundryvtt-compendium-sync:vtt-update',
						{ json, dir },
					);
				});
			}

			if ('updates' in _options) {
				_options.updates.forEach((update) => {
					const document = _collection.get(update._id);
					console.log('A Document has been updated.', document);

					if (!document) throw new Error('Document not found!?');

					const json = document.toJSON();
					import.meta.hot?.send(
						'foundryvtt-compendium-sync:vtt-update',
						{ json, dir },
					);
				});
			}

			if ('deleteAll' in _options) {
				_options.ids.forEach((id) => {
					console.log('A Document has been deleted.', id);

					import.meta.hot?.send(
						'foundryvtt-compendium-sync:vtt-delete',
						{ id, dir },
					);
				});
			}
		}),
	};

	// HMR
	import.meta.hot.accept();
	import.meta.hot.dispose(() => Object.entries(hooks).forEach(([k, v]) => Hooks.off(k, v)));

	// Messages
	import.meta.hot.on(
		'foundryvtt-compendium-sync:vtt-update:response',
		({ data: { json } }) => console.log(`Received and saved ${json.name} (${json._id})`),
	);

	import.meta.hot.on('foundryvtt-compendium-sync:system-update', async ({ json, timestamp, file }) => {
		const data = JSON.parse(json);
		let document: Document | null | undefined;

		if (data._stats.compendiumSource) document = await fromUuid(data._stats.compendiumSource);
		if (!document) document = await fromUuid(`Compendium.${moduleID}.${file.split('/')[1]}.${data._id}`);

		if (!document) throw new Error('Could not find document to update!');

		const foundryJSON = JSON.stringify(document.toJSON()).replaceAll(/"modifiedTime":\d+/g, '');
		const incomingJSON = json.replaceAll(/"modifiedTime":\d+/g, '');

		if (foundryJSON !== incomingJSON) await document.update(data, { modifiedTime: timestamp });
	});
}
