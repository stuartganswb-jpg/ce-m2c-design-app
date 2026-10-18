// 🧪 Printed documents: page breaks and the term's name (Eric's App Imp card 2026-10-16 · Stuart 2026-10-17).
//    node scripts/printDocs.test.mjs
import { formPrintCss, pageCssFor, SHEET_PAGE_CSS, stripPageRules, collectPrintStyles } from '../src/components/Shared/printStyles.js';
import { termNameOf, NS_TERM_NAMES } from '../src/components/Shared/nsTerms.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n}\n    got  ${JSON.stringify(a)}\n    want ${JSON.stringify(b)}`, JSON.stringify(a) === JSON.stringify(b));

// the term, by its name
eq('"3" prints Net 60 (SO60427\'s invoice read "TERMS 3")', termNameOf('3'), 'Net 60');
eq('every id NetSuite used on 10-17 has its name', ['1', '2', '13', '22', '27'].map(termNameOf), ['Net 15', 'Net 30', 'Credit Card', 'Pay Before Shipping', '.5% 10 Net 30']);
eq('a number NetSuite adds later never prints bare', termNameOf('31'), 'Term 31');
eq('a name typed by hand prints as typed; nothing prints nothing', [termNameOf('Net 30'), termNameOf(''), termNameOf(null), termNameOf(3)], ['Net 30', '', '', 'Net 60']);
ok('the table holds the twenty ids read', Object.keys(NS_TERM_NAMES).length === 20);

// the page box
eq('a document drawn as sheets prints at the sheets\' margins — whatever the caller asked', pageCssFor('<div class="pdf-page">…</div>', '@page { size: Letter portrait; margin: 0; }'), SHEET_PAGE_CSS);
eq('any other form keeps its caller\'s page', pageCssFor('<div class="ce-form">…</div>', '@page { margin: 0; }'), '@page { margin: 0; }');
eq('…or the Letter / half-inch default', pageCssFor('<div class="ce-form">…</div>'), '@page { size: Letter portrait; margin: 0.5in; }');
eq('a class merely CONTAINING the word does not count', pageCssFor('<div class="pdf-pages-x">', 'X'), 'X');

// the break rules
const css = formPrintCss();
ok('a sheet starts a page, the last one does not force a blank', /\.pdf-page \{[^}]*break-after: page/.test(css) && /\.pdf-page:last-child \{ break-after: auto/.test(css));
ok('a sheet\'s painted margins and height go (the page box carries them)', /\.pdf-page \{[^}]*padding: 0 !important/.test(css) && /min-height: 0 !important/.test(css));
ok('rows, pictures, totals, pay block, signature, footer never split', /tr, figure, img, \.ce-form-keep \{ break-inside: avoid/.test(css));
ok('a table header repeats on every page', /thead \{ display: table-header-group; \}/.test(css));
ok('the on-screen frame of a form does not print', /\.ce-form \{ border: none !important; box-shadow: none !important; max-width: none !important; padding: 0 !important; \}/.test(css));
ok('all of it only in print', /^\s*@media print \{/.test(css));
ok('the break rules carry no @page that could fight the page box', stripPageRules(css) === css);
// the popup's head still drops the label sheet and every stray @page
const head = collectPrintStyles([{ tagName: 'STYLE', id: 'ce-label-print-style', textContent: '@page{size:4in 2in}' }, { tagName: 'STYLE', id: '', textContent: '@page{margin:0} .a{color:red}' }]);
eq('the label sheet stays out; a stray @page is stripped', head, '<style> .a{color:red}</style>');

console.log(`printDocs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
