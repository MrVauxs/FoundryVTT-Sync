import type { Document } from "foundry-pf2e/foundry/common/abstract/module.js";
import type { Plugin } from "vite";
interface DefaultOptions {
    dataDirectory: string;
    transformer?: (doc: object) => Promise<Document["_source"]> | Document["_source"];
}
export default function vttSync(moduleJSON: {
    id: string;
}, options?: DefaultOptions): Plugin;
export {};
