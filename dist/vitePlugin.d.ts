import type { Document } from "foundry-pf2e/foundry/common/abstract/module.js";
import type { Plugin } from "vite";
/**
 * @prop { dataDirectory } - The directory to watch for updates in. Defaults to "data".
 * @prop { outputDirectory } - The directory to write the pack files to. Defaults to "packs".
 * @prop { transformer } - A function that takes a Document["_source"] and returns a Promise<Document["_source"]> | Document["_source"] | Promise<false> | false. This is used to transform the data before it is written to the pack file. Defaults to no transformation.
 */
interface DefaultOptions {
    dataDirectory?: string;
    outputDirectory?: string;
    transformer?: (doc: Document["_source"]) => Promise<void> | void | Promise<false> | false;
}
/**
 *
 * @param moduleJSON The module.json data. Best imported raw.
 * @param moduleJSON.id The module ID.
 * @param _options Where to store, compile, and how to transform data.
 */
export default function vttSync(moduleJSON: {
    id: string;
}, _options: DefaultOptions): Plugin[];
export {};
