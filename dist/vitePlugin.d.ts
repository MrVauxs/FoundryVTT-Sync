import type { Plugin } from 'vite';
export default function vttSync(moduleJSON: {
    id: string;
}, dataDirectory?: string): Plugin;
