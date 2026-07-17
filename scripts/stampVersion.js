// Stamps the deploy version into the build output (runs automatically via `npm run build`
// → postbuild hook, locally AND on Vercel):
//   • build/version.json — the tiny file the running app polls
//   • build/index.html   — <script>window.__APP_V="…"</script> so the served bundle knows
//     which version IT is (no env vars, no tracked-file churn between sessions)
// Shared/UpdateBanner.js compares the two and shows a one-tap "new version" reload banner
// when a newer deploy lands — replaces the ⌘⇧R ritual for the floor.
const fs = require('fs');
const path = require('path');

const v = String(Date.now());
const dir = path.join(__dirname, '..', 'build');
fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify({ v }));
const htmlPath = path.join(dir, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
fs.writeFileSync(htmlPath, html.replace('</head>', `<script>window.__APP_V="${v}"</script></head>`));
console.log('Stamped build version', v);
