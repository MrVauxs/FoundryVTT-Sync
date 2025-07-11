import fs from "node:fs";
import path from "node:path";
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import { log } from "./logs.js";
let hasInjectedCompendiumSync = false;
const defaultOptions = {
    dataDirectory: "data",
    outputDirectory: "packs",
    transformer: () => { },
};
function getSafeFilename(filename) {
    // eslint-disable-next-line regexp/no-obscure-range
    return filename.replace(/[^a-zA-Z0-9А-я]/g, "_");
}
async function onUpdate(data, client, options) {
    log(`Received an update: ${data.json.name}`);
    const name = data.json.name;
    if (options.transformer) {
        const denied = await options.transformer(data.json);
        if (denied === false) {
            console.warn(`Transformer returned a falsy value on "${name}"! No changes have been made.`);
            return;
        }
    }
    const { json, dir } = data;
    // Ensure the directory exists, create if not
    const targetDir = `${options.dataDirectory}/${dir}`;
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
    // Get a list of existing file paths
    const existingFiles = fs.readdirSync(targetDir);
    const newFilePath = `${targetDir}/${getSafeFilename(json.name)}_${json._id}.json`;
    // Check if the JSON exists. If it doesn't, check for any previous versions of the same file and delete them.
    if (!fs.existsSync(newFilePath)) {
        for (const file of existingFiles) {
            const filePath = `${options.dataDirectory}/${dir}/${file}`;
            if (fs.lstatSync(filePath).isDirectory())
                continue;
            const fileJson = JSON.parse(fs.readFileSync(filePath, "utf8"));
            // Check if the ID of the existing file matches with the incoming data's ID
            if (fileJson._id === json._id) {
                // If it does, delete the previous file
                fs.unlinkSync(filePath);
            }
        }
    }
    fs.writeFileSync(newFilePath, `${JSON.stringify(json, null, "\t")}\r\n`, "utf8");
    client.send("foundryvtt-compendium-sync:vtt-update:response", { data });
}
function onDelete(id, dir, options) {
    // Get a list of existing file paths
    const existingFiles = fs.readdirSync(`${options.dataDirectory}/${dir}`);
    for (const file of existingFiles) {
        const filePath = `${options.dataDirectory}/${dir}/${file}`;
        if (fs.lstatSync(filePath).isDirectory())
            continue;
        const fileJson = JSON.parse(fs.readFileSync(filePath, "utf8"));
        // Check if the ID of the existing file matches with the incoming data's ID
        if (fileJson._id === id) {
            // Create _deleted directory if it doesn't exist yet.
            if (!fs.existsSync(`${options.dataDirectory}/${dir}/_deleted`)) {
                fs.mkdirSync(`${options.dataDirectory}/${dir}/_deleted`);
            }
            try {
                // Move to _deleted/ for safekeeping.
                fs.renameSync(filePath, `${options.dataDirectory}/${dir}/_deleted/${file}`);
            }
            catch {
                console.error("Could not move file to _deleted directory. Remove manually!");
            }
        }
    }
}
/**
 *
 * @param moduleJSON The module.json data. Best imported raw.
 * @param moduleJSON.id The module ID.
 * @param _options Where to store, compile, and how to transform data.
 */
export default function vttSync(moduleJSON, _options) {
    const options = _options;
    for (const key in defaultOptions) {
        // @ts-expect-error I can't be arsed to make this type-safe, I am assigning it the same keys.
        options[key] ??= defaultOptions[key];
    }
    return [
        {
            name: "foundryvtt-sync:serve",
            apply: "serve",
            configureServer(server) {
                server.watcher.add([options.dataDirectory]);
                server.ws.on("foundryvtt-compendium-sync:vtt-update", (data, client) => onUpdate(data, client, options));
                server.ws.on("foundryvtt-compendium-sync:vtt-delete", ({ id, dir }) => onDelete(id, dir, options));
            },
            async handleHotUpdate({ file, server, timestamp, read }) {
                if (file.startsWith(`${options.dataDirectory}/`)
                    && file.endsWith("json")
                    && !file.includes("/_deleted")) {
                    setTimeout(async () => {
                        const content = await read();
                        try {
                            const data = JSON.parse(content);
                            server.ws.send({
                                type: "custom",
                                event: "foundryvtt-compendium-sync:system-update",
                                data: { json: JSON.stringify(data), file, timestamp },
                            });
                        }
                        catch (err) {
                            console.warn(err);
                        }
                    }, 500);
                }
            },
            config: () => ({ define: { __VTT_SYNC_MODULE__: moduleJSON } }),
            transform(code) {
                if (!hasInjectedCompendiumSync) {
                    code += `\n\nimport compendiumSync from 'foundryvtt-sync/dist/compendiumSync';\ncompendiumSync()\n\n`;
                    hasInjectedCompendiumSync = true;
                    log("Injected compendium sync code.");
                }
                return code;
            },
        },
        {
            name: "foundryvtt-sync:build",
            apply: "build",
            enforce: "post",
            configResolved() {
                const outDir = path.resolve(process.cwd(), options.outputDirectory);
                log(`Cleaning ${outDir}...`);
                if (fs.existsSync(outDir)) {
                    const filesToClean = (fs.readdirSync(outDir)).map(dirName => path.resolve(outDir, dirName));
                    for (const file of filesToClean) {
                        fs.rmSync(file, { recursive: true });
                    }
                }
                else {
                    fs.mkdirSync(outDir, { recursive: true });
                }
                async function compileMultiple(packFolders, previous) {
                    for (const pack of packFolders) {
                        if (pack.isDirectory() && pack.name !== "_deleted") {
                            const filepath = path.resolve(previous, pack.name);
                            const files = fs.readdirSync(filepath, { withFileTypes: true });
                            if (files.some(x => x.isDirectory() && x.name !== "_deleted")) {
                                await compileMultiple(files, `${previous}/${pack.name}`);
                            }
                            else {
                                const output = path.resolve(outDir, `${pack.name}`);
                                if (!fs.existsSync(output)) {
                                    fs.mkdirSync(output, { recursive: true });
                                }
                                await compilePack(filepath, output);
                            }
                        }
                    }
                }
                log(`Compiling to ${outDir}...`);
                try {
                    const packFolders = fs.readdirSync(options.dataDirectory, { withFileTypes: true });
                    compileMultiple(packFolders, options.dataDirectory);
                }
                catch {
                    console.warn(`The given data directory (${options.dataDirectory}) does not exist!`);
                }
            },
        },
    ];
}
;
//# sourceMappingURL=vitePlugin.js.map