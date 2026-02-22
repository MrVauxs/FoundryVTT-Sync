import type Document from "@7h3laughingman/foundry-types/common/abstract/document.mjs";
/**
 * @prop { dataDirectory } - The directory to watch for updates in. Defaults to "data".
 * @prop { outputDirectory } - The directory to write the pack files to. Defaults to "packs".
 * @prop { transformer } - A function that takes a Document["_source"] and returns a Promise<Document["_source"]> | Document["_source"] | Promise<false> | false. This is used to transform the data before it is written to the pack file. Defaults to no transformation.
 */
export interface PluginOptions {
    dataDirectory?: string;
    outputDirectory?: string;
    transformer?: (doc: Document["_source"]) => Promise<void> | void | Promise<false> | false;
}
/**
 * Creates a FoundryVTT compendium sync plugin using unplugin.
 *
 * @param moduleJSON The module.json data. Best imported raw.
 * @param moduleJSON.id The module ID.
 * @param _options Where to store, compile, and how to transform data.
 */
export declare function createPlugin(moduleJSON: {
    id: string;
}, _options?: PluginOptions): import("unplugin").UnpluginInstance<unknown, boolean>;
export type UnpluginInstance = ReturnType<typeof createPlugin>;
