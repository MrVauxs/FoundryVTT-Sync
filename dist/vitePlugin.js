import fs from 'node:fs';
export default function vttSync(moduleJSON, dataDirectory = 'data') {
    return {
        name: 'foundryvtt-compendium-sync',
        configureServer(server) {
            server.ws.on('foundryvtt-compendium-sync:vtt-update', (data, client) => {
                console.log('Received an update:', data.json.name);
                const { json, dir } = data;
                // Get a list of existing file paths
                const existingFiles = fs.readdirSync(`${dataDirectory}/${dir}`);
                const newFilePath = `${dataDirectory}/${dir}/${json.name}-${json._id}.json`;
                // Check if the JSON exists. If it doesn't, check for any previous versions of the same file and delete them.
                if (!fs.existsSync(newFilePath)) {
                    for (const file of existingFiles) {
                        const filePath = `${dataDirectory}/${dir}/${file}`;
                        if (fs.lstatSync(filePath).isDirectory())
                            continue;
                        const fileJson = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                        // Check if the ID of the existing file matches with the incoming data's ID
                        if (fileJson._id === json._id) {
                            // If it does, delete the previous file
                            fs.unlinkSync(filePath);
                        }
                    }
                }
                fs.writeFileSync(newFilePath, JSON.stringify(json, null, '\t'));
                client.send('foundryvtt-compendium-sync:vtt-update:response', { data });
            });
            server.ws.on('foundryvtt-compendium-sync:vtt-delete', ({ id, dir }) => {
                // Get a list of existing file paths
                const existingFiles = fs.readdirSync(`${dataDirectory}/${dir}`);
                for (const file of existingFiles) {
                    const filePath = `${dataDirectory}/${dir}/${file}`;
                    if (fs.lstatSync(filePath).isDirectory())
                        continue;
                    const fileJson = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    // Check if the ID of the existing file matches with the incoming data's ID
                    if (fileJson._id === id) {
                        // Create _deleted directory if it doesn't exist yet.
                        if (!fs.existsSync(`${dataDirectory}/${dir}/_deleted`)) {
                            fs.mkdirSync(`${dataDirectory}/${dir}/_deleted`);
                        }
                        try {
                            // Move to _deleted/ for safekeeping.
                            fs.renameSync(filePath, `${dataDirectory}/${dir}/_deleted/${file}`);
                        }
                        catch {
                            console.error('Could not move file to _deleted directory. Remove manually!');
                        }
                    }
                }
            });
            server.watcher.add(['./data']);
        },
        async handleHotUpdate({ file, server, timestamp, read }) {
            if (file.startsWith(`${dataDirectory}/`)
                && file.endsWith('json')
                && !file.includes('/_deleted')) {
                const content = await read();
                const data = JSON.parse(content);
                server.ws.send({
                    type: 'custom',
                    event: 'foundryvtt-compendium-sync:system-update',
                    data: { json: JSON.stringify(data), file, timestamp },
                });
            }
        },
        apply: 'serve',
        config: async () => ({
            define: {
                __VTT_SYNC_MODULE__: moduleJSON
            }
        })
    };
}
;
//# sourceMappingURL=vitePlugin.js.map