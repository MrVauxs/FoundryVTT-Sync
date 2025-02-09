declare const __VTT_SYNC_MODULE__: { id: string };

declare module "@foundryvtt/foundryvtt-cli" {
	interface PackageOptions { nedb?: boolean; yaml?: boolean; log?: boolean; transformEntry?: EntryTransformer }
    type EntryTransformer = (entry: object) => Promise<false | void>;
    type CompileOptions = PackageOptions & { recursive?: boolean };
    /**
     * Compile source files into a compendium pack.
     * @param {string} src   The directory containing the source files.
     * @param {string} dest  The target compendium pack. This should be a directory for LevelDB packs, or a .db file for NeDB packs.
     * @param {CompileOptions} [options]
     * @returns {Promise<void>}
     */
    export function compilePack(src: string, dest: string, options?: options): Promise<void>;
}
