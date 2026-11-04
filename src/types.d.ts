declare module "@foundryvtt/foundryvtt-cli" {
	type EntryTransformer = (entry: any, context?: Record<string, any>) => Promise<false | void> | false | void;
	type NameTransformer = (entry: any, context?: Record<string, any>) => Promise<string | void> | string | void;
	type SerializationTransformer = (content: string, context: { filename: string; yaml: boolean }) => Promise<string> | string;

	interface PackageOptions {
		nedb?: boolean;
		yaml?: boolean;
		log?: boolean;
		transformEntry?: EntryTransformer;
	}

	interface CompileOptions extends PackageOptions {
		recursive?: boolean;
	}

	interface ExtractOptions extends PackageOptions {
		yamlOptions?: Record<string, any>;
		jsonOptions?: { replacer?: ((key: string, value: any) => any) | (string | number)[] | null; space?: string | number };
		documentType?: string;
		collection?: string;
		clean?: boolean;
		folders?: boolean;
		expandAdventures?: boolean;
		omitVolatile?: boolean;
		transformName?: NameTransformer;
		transformFolderName?: NameTransformer;
		transformSerialized?: SerializationTransformer;
	}

	/**
	 * Compile source files into a compendium pack.
	 * @param src   The directory containing the source files.
	 * @param dest  The target compendium pack. This should be a directory for LevelDB packs, or a .db file for NeDB packs.
	 */
	export function compilePack(src: string, dest: string, options?: CompileOptions): Promise<void>;

	/**
	 * Extract the contents of a compendium pack into individual source files for each primary Document.
	 * @param src   The source compendium pack. This should be a directory for LevelDB pack, or a .db file for NeDB packs.
	 * @param dest  The directory to write the extracted files into.
	 */
	export function extractPack(src: string, dest: string, options?: ExtractOptions): Promise<void>;
}
