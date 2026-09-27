// Loop-test resolve hook: the app's Firebase and NetSuite proxy are swapped for in-memory fakes, and
// CRA's extensionless relative imports resolve to .js — so the REAL route modules run under node.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = (f) => new URL(f, import.meta.url).href;
export async function resolve(specifier, context, next) {
    if (specifier === 'firebase/firestore') return { url: here('./fake-firestore.mjs'), shortCircuit: true };
    if (/^firebase\//.test(specifier)) return { url: here('./fake-firebase.mjs'), shortCircuit: true };
    if (/(^|\/)firebase(\.js)?$/.test(specifier) && specifier.startsWith('.')) return { url: here('./fake-firebase.mjs'), shortCircuit: true };
    if (/(^|\/)nsProxy(\.js)?$/.test(specifier) && specifier.startsWith('.')) return { url: here('./fake-nsproxy.mjs'), shortCircuit: true };
    if (specifier.startsWith('.') && context.parentURL && !/\.[a-z]+$/i.test(specifier)) {
        const base = fileURLToPath(new URL(specifier, context.parentURL));
        for (const ext of ['.js', '.mjs', '/index.js']) if (existsSync(base + ext)) return next(pathToFileURL(base + ext).href, context);
    }
    return next(specifier, context);
}
export async function load(url, context, next) {
    // The app's source is ESM without "type": "module" — say so, instead of node guessing per file.
    if (url.includes('/src/') && url.endsWith('.js')) return next(url, { ...context, format: 'module' });
    return next(url, context);
}
