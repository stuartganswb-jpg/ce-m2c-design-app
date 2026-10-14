// THE CONFIGURATOR'S THREE CALLS (step 4 of the portal rebuild, 2026-10-14) — the server decides, this page draws.
//   portalConfigFlows    the products this login may configure (Portal Access: live, and preview for a previewer)
//   portalConfigView     everything one set of answers looks like: the steps, the finishes, the picture, the price
//   portalConfigRequest  the request — every line worked out again on the server, at the customer's own level
// Every call carries the engine this site was built with (__SITE_ENGINE__, vite.config.js); a server running another engine
// answers with neither a view nor a request, and this page says which of the two is behind.
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export const SITE_ENGINE = __SITE_ENGINE__;

const call = (name) => httpsCallable(functions, name);

export const loadFlows = async () => (await call('portalConfigFlows')()).data || { flows: [] };
export const loadView = async ({ flowId, state, ui }) => (await call('portalConfigView')({ flowId, state, ui, site: SITE_ENGINE })).data;
export const sendRequest = async ({ lines, note, sidemark }) => (await call('portalConfigRequest')({ lines, note, sidemark, site: SITE_ENGINE })).data;

// What went wrong, in the customer's words — and whether reloading the page is the cure. When the server refuses a site
// built with another engine, the site published with THIS deploy is read: if it is newer than this open page, the page
// is what is behind (a reload fixes it); otherwise the server is (it is being updated).
export async function troubleOf(e) {
  const code = String((e && e.code) || '');
  const details = (e && e.details) || {};
  if (/failed-precondition/.test(code) && details.reason === 'ENGINE_BEHIND') {
    try {
      const r = await fetch(`/engine.json?t=${Date.now()}`, { cache: 'no-store' });
      const live = r.ok ? await r.json() : null;
      if (live && live.closureHash && live.closureHash !== SITE_ENGINE.closureHash) return { text: 'A newer version of this page is ready.', reload: true };
    } catch (_) { /* fall through: say it is being updated */ }
    return { text: 'The configurator is being updated — please try again in a few minutes.' };
  }
  if (/permission-denied/.test(code)) return { text: 'This product is not enabled on your account. Contact your Classical Elements representative.' };
  if (/failed-precondition|invalid-argument/.test(code) && e.message) return { text: String(e.message).replace(/^(FirebaseError:\s*)/, ''), line: details.line || null };
  if (/unavailable|deadline|internal/.test(code)) return { text: 'Could not reach the configurator just now — please try again.' };
  return { text: 'Something went wrong — please try again.' };
}
