# FoundryVTT-Sync

A Vite plugin to sync FoundryVTT compendiums with your file system.

## How to Use

1. Add `vttSync(moduleJSON)` plugin to your Vite plugins.
2. That's it!
3. If you are getting type errors, just make it "vttSync(...) as Plugin[]" =\_=

## Ok but what does it do?

The plugin comes in two parts.

The first is that during `vite dev`, it will sync any `updateCompendium` changes to your local file system, so any updates you make to the compendium are immediately exported out to the module files you are working on. This connection is two-way, you can also do quick edits inside your editor and it will be reflected in Foundry!

The second is that during `vite build`, it will build the JSON files using `foundryvtt-cli` into the LevelDB database directories.

## Why?

So you don't have to manually disable the module in order to update your local files, if not outright forgetting to run your extract-packs script.
