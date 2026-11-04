# FoundryVTT-Sync

A cross-bundler plugin to sync FoundryVTT compendiums with your file system. Supports **Vite**, **Rollup**, **Webpack**, and **esbuild**.

## Installation

```bash
npm install --save-dev foundryvtt-sync
# or
bun add -d foundryvtt-sync
# or
pnpm add -D foundryvtt-sync
```

## Usage

### Vite (Recommended)

The Vite integration also adds [live sync](#live-sync) while the dev server runs.

```typescript
import foundryvttSync from "foundryvtt-sync/vite";
// vite.config.ts
import { defineConfig } from "vite";
import moduleJSON from "./module.json" with { type: "json" };

export default defineConfig({
	plugins: [
		foundryvttSync(moduleJSON, {
			dataDirectory: "data",
			outputDirectory: "packs",
		}),
	],
});
```

### Rollup

```typescript
// rollup.config.mjs
import foundryvttSync from "foundryvtt-sync/rollup";
import moduleJSON from "./module.json" with { type: "json" };

export default {
	input: "src/index.js",
	output: {
		dir: "dist",
		format: "es",
	},
	plugins: [
		foundryvttSync(moduleJSON, {
			dataDirectory: "data",
			outputDirectory: "packs",
		}),
	],
};
```

### Webpack

```javascript
// webpack.config.js
const foundryvttSync = require("foundryvtt-sync/webpack");
const moduleJSON = require("./module.json");

module.exports = {
	entry: "./src/index.js",
	output: {
		path: path.resolve(__dirname, "dist"),
		filename: "bundle.js",
	},
	plugins: [
		foundryvttSync(moduleJSON, {
			dataDirectory: "data",
			outputDirectory: "packs",
		}),
	],
};
```

### esbuild

```javascript
import { readFileSync } from "node:fs";
// build.js
import * as esbuild from "esbuild";
import foundryvttSync from "foundryvtt-sync/esbuild";

const moduleJSON = JSON.parse(readFileSync("./module.json"));

await esbuild.build({
	entryPoints: ["src/index.js"],
	bundle: true,
	outfile: "dist/bundle.js",
	plugins: [foundryvttSync(moduleJSON)],
});
```

### Backwards Compatible Import

The default export is still available for backwards compatibility:

```typescript
// vite.config.ts
import vttSync from "foundryvtt-sync"; // Returns Plugin[] for Vite
import moduleJSON from "./module.json" with { type: "json" };

export default {
	plugins: [
		...vttSync(moduleJSON, { dataDirectory: "data" }),
	],
};
```

## Options

```typescript
interface PluginOptions {
	// Your root JSON directory (default: "data")
	dataDirectory?: string;
	// Your root Foundry DB directory (default: "packs")
	outputDirectory?: string;
	// Live sync runs this on every document before writing it to dataDirectory. Returning false skips the write.
	transformer?: (doc: Document["_source"]) => Promise<void> | void | Promise<false> | false;
	// Live sync leaves Adventure documents alone, in both directions (default: false)
	ignoreAdventureHMR?: boolean;
	// The foundryvtt-cli extractPack options live sync writes files with. Use the ones from your extract script.
	// Default: { folders: true, expandAdventures: true, omitVolatile: true, jsonOptions: { space: "\t" } }
	extractOptions?: ExtractOptions;
}
```

## What Does It Do?

The plugin comes in two parts:

1. **Build**: During build, it compiles the JSON (or YAML) files in `dataDirectory` into LevelDB packs in `outputDirectory` with `foundryvtt-cli`.

2. **Live sync (Vite dev server only)**: While `vite` runs, a GM can turn on a two-way sync between the module's compendiums and your data files.

## Live sync

Run the Vite dev server and open Foundry through it (`npm run dev` in the create-fvtt-module template, port 30001). GMs get a sync button in the bottom right corner, next to the sidebar. It starts off, and a page reload turns it off again, so nothing syncs until you click it. The plugin adds the button's code to your module's entry file (`build.lib.entry` or `build.rollupOptions.input`) on the dev server only. Builds don't contain it.

While it's on:

- Changes made in Foundry are written to `dataDirectory`. That covers creating, editing, renaming and moving documents and folders, and embedded documents such as items on actors or journal pages. A deleted document's file moves to `<dataDirectory>/_deleted/<pack>/`, which the build skips.
- Saving a file in your editor applies it to the compendium. Only the fields you changed are sent, and they replace the old values instead of merging into them, so a key you delete from the file is deleted in Foundry too. Adding or removing embedded documents in the file adds or removes them in Foundry, and a new file creates a new document.
- The terminal running Vite logs each write, in both directions.

Things to know:

- To write files, live sync compiles the changed documents into a temporary pack and extracts it with `foundryvtt-cli`. File names, folders and expanded Adventures therefore come out the way your extract script makes them, as long as `extractOptions` uses the same options. The defaults match the [create-fvtt-module](https://github.com/MrVauxs/create-fvtt-module) template.
- Editors that save as you type leave broken JSON behind. Live sync skips a file it can't parse, logs the error in the terminal once, and waits for the next save. A file that parses but that Foundry rejects (an empty `name`, say) gets one warning in Foundry and in the terminal, and nothing is applied until you fix it.
- Changes that came from a file are not written back to it. If Foundry adjusts a value (pf2e caps HP at the maximum) or you rename a document in its file, the file keeps what you typed. The next edit made in Foundry rewrites it, under the new name if it has one.
- Locked compendiums can't change. Unlock the module's compendium in Foundry, then save the file again.
- With `omitVolatile`, embedded documents that didn't change keep the timestamps already in their file, so diffs show only real changes. Live sync also keeps the file's `_stats.compendiumSource` when Foundry's copy points at the document itself, which pf2e does in memory for compendium content.

### Isn't This Unsafe?

The plugin never opens your module's database. Foundry applies every change through its own API, and files are written from the data Foundry sends to Vite over the dev server's websocket. The only LevelDB it touches is a temporary copy it uses to name and lay out the files.

## Why?

So you don't have to manually disable the module in order to update your local files, if not outright forgetting to run your extract-packs script. This package also takes care of making the JSON → LevelDB build step for you.

## Bundler Support Matrix

| Feature          | Vite | Rollup | Webpack | esbuild |
| ---------------- | ---- | ------ | ------- | ------- |
| Pack compilation | ✅    | ✅      | ✅       | ✅       |
| Live sync        | ✅    | ❌      | ❌       | ❌       |

## Types

The plugin requires the module JSON file, easily importable in Node.js:

```js
import moduleJSON from './module.json' with { type: 'json' };
```

You may also use an object with an `id` string (`{ id: string }`), but this may be expanded upon in the future.

## License

MIT
