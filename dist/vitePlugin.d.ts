import type { Document } from "foundry-pf2e/foundry/common/abstract/module.js";
import type { Plugin } from "vite";
interface DefaultOptions {
    dataDirectory: string;
    outputDirectory: string;
    transformer?: (doc: Document["_source"]) => Promise<Document["_source"]> | Document["_source"] | Promise<false> | false;
}
export default function vttSync(moduleJSON: {
    id: string;
}, options?: DefaultOptions): Plugin[];
export {};
