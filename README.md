# FoundryVTT-Sync
A Vite plugin to sync FoundryVTT compendiums with your file system.

## How to Use
1. Add `vttSync()` plugin to your Vite plugins.
2. Import the `compendiumSync.ts` to your index. It will only trigger in `vite dev` mode.
3. Add the following alias to Vite `resolve.alias`:
```js
resolve: {
    alias: {
        moduleJSON: path.resolve(__dirname, './module.json'),
    },
}
```