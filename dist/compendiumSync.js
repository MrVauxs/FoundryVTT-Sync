function documentExportToCLI(rootDoc) {
    const json = rootDoc.toJSON();
    json._key = `!${rootDoc.collectionName}!${rootDoc.id}`;
    recursiveKeys(rootDoc);
    // document: { items: [ { effects: [] } ] }
    function recursiveKeys(document, collectionKeys = [rootDoc.collectionName]) {
        Object.keys(document.collections).forEach((key) => {
            const value = document.collections[key].contents.map((embed) => {
                const json = embed.toJSON();
                collectionKeys.push(embed.collectionName);
                json._key = `!${collectionKeys.join(".")}!${embed.id}`;
                if (embed.collections)
                    recursiveKeys(embed, collectionKeys);
                return json;
            });
            json[key] = value;
        });
    }
    return json;
}
export default function compendiumSync() {
    if (import.meta.hot) {
        const { id: moduleID } = __VTT_SYNC_MODULE__;
        const hooks = {
            ready: Hooks.on("ready", () => {
                // #region Libwrapper
                // https://github.com/foundryvtt/foundryvtt/issues/12134
                if (!game.modules.get("lib-wrapper")?.active && game.user.isGM) {
                    ui.notifications.error("Compendium Sync requires the 'libWrapper' module in order to sync Compendium Folders.");
                }
                else {
                    libWrapper.register(moduleID, "CompendiumFolderCollection.prototype._onModifyContents", function (_action, documents, _result, operation, user) {
                        Hooks.callAll("updateCompendium", this, documents, operation, user.id);
                    }, "LISTENER");
                }
                // #endregion
                ui.notifications.info("Compendium Sync is now active.");
                const compendia = game.packs.filter(c => c.metadata.packageName === moduleID);
                console.log(`Found ${compendia.length} compendiums:`);
                compendia.forEach(async (compendium) => {
                    const documents = await compendium.getDocuments();
                    [...documents, ...compendium.folders].forEach((doc) => {
                        import.meta.hot?.send("foundryvtt-compendium-sync:vtt-update", {
                            json: documentExportToCLI(doc),
                            dir: compendium.metadata.name,
                        });
                    });
                });
            }),
            updateCompendium: Hooks.on("updateCompendium", (_collection, _data, _options) => {
                // Check if _collection isn't the CompendiumFolderCollection instance.
                // @ts-expect-error No Types Yet
                if ((_collection instanceof CompendiumFolderCollection))
                    _collection.metadata = _collection.pack.metadata;
                if (_collection?.metadata?.packageName !== moduleID)
                    return;
                const dir = _collection.metadata.name;
                if ("data" in _options) {
                    _options.data.forEach((doc) => {
                        const document = _collection.get(doc._id);
                        console.log("A Document has been created.", document);
                        if (!document)
                            throw new Error("Document not found!?");
                        import.meta.hot?.send("foundryvtt-compendium-sync:vtt-update", {
                            json: documentExportToCLI(document),
                            dir,
                        });
                    });
                }
                if ("updates" in _options) {
                    _options.updates.forEach((update) => {
                        const document = _collection.get(update._id);
                        console.log("A Document has been updated.", document);
                        if (!document)
                            throw new Error("Document not found!?");
                        import.meta.hot?.send("foundryvtt-compendium-sync:vtt-update", {
                            json: documentExportToCLI(document),
                            dir,
                        });
                    });
                }
                if ("deleteAll" in _options) {
                    _options.ids.forEach((id) => {
                        console.log("A Document has been deleted.", id);
                        import.meta.hot?.send("foundryvtt-compendium-sync:vtt-delete", { id, dir });
                    });
                }
            }),
        };
        // HMR
        import.meta.hot.accept();
        import.meta.hot.dispose(() => Object.entries(hooks).forEach(([k, v]) => Hooks.off(k, v)));
        // Messages
        import.meta.hot.on("foundryvtt-compendium-sync:vtt-update:response", ({ data: { json } }) => console.log(`Received and saved ${json.name} (${json._id})`));
        import.meta.hot.on("foundryvtt-compendium-sync:system-update", async ({ json, timestamp, file }) => {
            const data = JSON.parse(json);
            let document;
            if (data._stats.compendiumSource)
                document = await fromUuid(data._stats.compendiumSource);
            if (!document)
                document = await fromUuid(`Compendium.${moduleID}.${file.split("/")[1]}.${data._id}`);
            if (!document)
                throw new Error("Could not find document to update!");
            const foundryJSON = JSON.stringify(document.toJSON()).replaceAll(/"modifiedTime":\d+/g, "");
            const incomingJSON = json.replaceAll(/"modifiedTime":\d+/g, "").replaceAll(/(,?)"_key":(\s?)".+?"/g, "");
            if (foundryJSON !== incomingJSON)
                await document.update(data, { modifiedTime: timestamp });
        });
    }
}
//# sourceMappingURL=compendiumSync.js.map