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

The Vite integration includes full dev server support with HMR and WebSocket communication.

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import foundryvttSync from 'foundryvtt-sync/vite';
import moduleJSON from './module.json' with { type: 'json' };

export default defineConfig({
  plugins: [
    foundryvttSync(moduleJSON, {
      dataDirectory: 'data',
      outputDirectory: 'packs',
    }),
  ],
});
```

### Rollup

```typescript
// rollup.config.mjs
import foundryvttSync from 'foundryvtt-sync/rollup';
import moduleJSON from './module.json' with { type: 'json' };

export default {
  input: 'src/index.js',
  output: {
    dir: 'dist',
    format: 'es',
  },
  plugins: [
    foundryvttSync(moduleJSON, {
      dataDirectory: 'data',
      outputDirectory: 'packs',
    }),
  ],
};
```

### Webpack

```javascript
// webpack.config.js
const foundryvttSync = require('foundryvtt-sync/webpack');
const moduleJSON = require('./module.json');

module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
  },
  plugins: [
    foundryvttSync(moduleJSON, {
      dataDirectory: 'data',
      outputDirectory: 'packs',
    }),
  ],
};
```

### esbuild

```javascript
// build.js
import * as esbuild from 'esbuild';
import foundryvttSync from 'foundryvtt-sync/esbuild';
import { readFileSync } from 'fs';

const moduleJSON = JSON.parse(readFileSync('./module.json'));

await esbuild.build({
  entryPoints: ['src/index.js'],
  bundle: true,
  outfile: 'dist/bundle.js',
  plugins: [foundryvttSync(moduleJSON)],
});
```

### Backwards Compatible Import

The default export is still available for backwards compatibility:

```typescript
// vite.config.ts
import vttSync from 'foundryvtt-sync'; // Returns Plugin[] for Vite
import moduleJSON from './module.json' with { type: 'json' };

export default {
  plugins: [
    ...vttSync(moduleJSON, { dataDirectory: 'data' }),
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
  // Runs on the server. Returning false invalidates the entry.
  transformer?: (doc: Document["_source"]) => Promise<void> | void | Promise<false> | false;
}
```

## What Does It Do?

The plugin comes in two parts:

1. **Dev Server (Vite only)**: During development, it syncs any changes made in your module compendiums to your local file system. Any updates you make to the compendium are immediately exported to the module files you are working on. This connection is two-way — you can also do quick edits inside your editor and it will be reflected in Foundry!

2. **Build**: During build, it compiles the JSON files using `foundryvtt-cli` into the LevelDB database directories.

### Isn't This Unsafe?

The plugin does not access the underlying database at all! Instead, it uses websockets to prompt Foundry to update the documents using its own connection, or export the JSON and send it back to Vite to update the module data.

## Why?

So you don't have to manually disable the module in order to update your local files, if not outright forgetting to run your extract-packs script. This package also takes care of making the JSON → LevelDB build step for you.

## Bundler Support Matrix

| Feature | Vite | Rollup | Webpack | esbuild |
|---------|------|--------|---------|---------|
| Pack compilation | ✅ | ✅ | ✅ | ✅ |
| Code transform | ✅ | ✅ | ✅ | ✅ |
| Define globals | ✅ | ✅ | ✅ | ✅ |
| Dev server HMR | ✅ | ❌ | ❌ | ❌ |
| WebSocket sync | ✅ | ❌ | ❌ | ❌ |

## Types

The plugin requires the module JSON file, easily importable in Node.js:

```js
import moduleJSON from './module.json' with { type: 'json' };
```

You may also use an object with an `id` string (`{ id: string }`), but this may be expanded upon in the future.

## License

MIT
