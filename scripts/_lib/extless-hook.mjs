// Node resolve hook for the harness: CRA source omits ".js" on relative imports, and the app's
// firebase bootstrap needs a browser — '../../firebase' resolves to an empty stub instead.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const STUB = new URL('./firebase-stub.mjs', import.meta.url).href;
export async function resolve(specifier, context, next) {
  if (/(^|\/)firebase$/.test(specifier) && (specifier.startsWith('./') || specifier.startsWith('../'))) return { url: STUB, shortCircuit: true };
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier) && context.parentURL) {
    const base = fileURLToPath(new URL(specifier, context.parentURL));
    for (const ext of ['.js', '.mjs', '/index.js']) if (existsSync(base + ext)) return next(pathToFileURL(base + ext).href, context);
  }
  return next(specifier, context);
}
