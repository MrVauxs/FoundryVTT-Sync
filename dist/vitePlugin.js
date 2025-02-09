import fs from "node:fs";
let hasInjectedCompendiumSync = false;
const defaultOptions = {
    dataDirectory: "data",
};
async function onUpdate(data, client, options) {
    console.log("Received an update:", data.json.name);
    const name = data.json.name;
    if (options.transformer)
        data.json = await options.transformer(data.json);
    if (!data.json) {
        console.warn(`Transformer returned a falsy value on "${name}"! No changes have been made.`);
        return;
    }
    const { json, dir } = data;
    // Get a list of existing file paths
    const existingFiles = fs.readdirSync(`${options.dataDirectory}/${dir}`);
    const newFilePath = `${options.dataDirectory}/${dir}/${json.name}-${json._id}.json`;
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
    fs.writeFileSync(newFilePath, JSON.stringify(json, null, "\t"));
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
export default function vttSync(moduleJSON, options = defaultOptions) {
    return {
        name: "foundryvtt-compendium-sync",
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
                const content = await read();
                const data = JSON.parse(content);
                server.ws.send({
                    type: "custom",
                    event: "foundryvtt-compendium-sync:system-update",
                    data: { json: JSON.stringify(data), file, timestamp },
                });
            }
        },
        config: () => ({ define: { __VTT_SYNC_MODULE__: moduleJSON } }),
        transform(code) {
            if (!hasInjectedCompendiumSync) {
                code += `\n\nimport { compendiumSync } from 'foundryvtt-sync';\ncompendiumSync()\n\n`;
                hasInjectedCompendiumSync = true;
                console.log("[foundryvtt-compendium-sync] Injected compendium sync code.");
            }
            return code;
        },
    };
}
;
//# sourceMappingURL=vitePlugin.js.map