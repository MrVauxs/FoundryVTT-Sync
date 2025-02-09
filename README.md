# FoundryVTT-Sync

A Vite plugin to sync FoundryVTT compendiums with your file system.

## How to Use

0. Install using `npm i --save-dev https://github.com/MrVauxs/FoundryVTT-Sync`
1. Add `vttSync(moduleJSON)` plugin to your Vite plugins.
2. That's it!
3. If you are getting type errors, just make it "vttSync(...) as Plugin[]" =\_= (or submit a PR fixing this type error!)

## Ok but what does it do?

The plugin comes in two parts.

The first is that during `vite dev`, it will sync any `updateCompendium` changes to your local file system, so any updates you make to the compendium are immediately exported out to the module files you are working on. This connection is two-way, you can also do quick edits inside your editor and it will be reflected in Foundry!

The second is that during `vite build`, it will build the JSON files using `foundryvtt-cli` into the LevelDB database directories.

## Why?

So you don't have to manually disable the module in order to update your local files, if not outright forgetting to run your extract-packs script.

## Types

`vttSync` requires the module JSON file, easily importable in node with
```js
import moduleJSON from './module.json' with { type: 'json' };
```
You may also use an object with id string at the time of writing this (`{ id: string }`), but this may be expanded upon so this is not a recommended solution.

`vttSync` also has an optional secondary parameter, in which you define filepaths and a transformer.
```ts
interface DefaultOptions {
    // Your root JSON directory (data/)
    dataDirectory: string;
    // Your root Foundry DB directory (packs/)
    outputDirectory: string;
    // Runs on the server. Returning a false value invalidates the entry, causing no changes to be made.
    transformer?: (doc: object) => Promise<Document["_source"]> | Document["_source"] | Promise<false> | false;
}
```
