#!/bin/sh
# Run the traverse model + generator tests.
#
# Firestore enforces App Check and the app is behind a PIN gate, so nothing can drive the real app
# from a script — pure modules + node tests are the only verification available for this feature.
# The modules are plain ESM but live in a CRA package (no "type": "module"), so node cannot import
# the .js files directly. Stage them as .mjs in a temp dir, fix the extensionless internal imports,
# and run there.
#
#   sh scripts/run-traverse-tests.sh
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

for f in traverseTags traverseFlow traverseKitImport nodeList priceLevels kitCode; do
    sed -e "s#from '\./traverseTags'#from './traverseTags.mjs'#" \
        -e "s#from '\./nodeList'#from './nodeList.mjs'#" \
        "$ROOT/src/components/Shared/$f.js" > "$OUT/$f.mjs"
done
cp "$ROOT"/scripts/*.test.mjs "$OUT/"

# The kit-import tests run against the REAL Fabricut sheet when it is present — extracted to JSON
# here because node has no xlsx reader. Absent sheet = those tests skip, the rest still run.
SHEET="$ROOT/Fabricut/Aug12/Fabricut_Traverse.xlsx"
if [ -f "$SHEET" ] && command -v python3 >/dev/null; then
    python3 - "$SHEET" "$OUT/kit_sheet.json" <<'PYEOF' || true
import sys, json
try:
    import openpyxl
except ImportError:
    sys.exit(1)
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
sheets = []
for name in wb.sheetnames:
    ws = wb[name]
    grid = [[c.value for c in row] for row in ws.iter_rows(min_row=1, max_row=ws.max_row, max_col=ws.max_column)]
    sheets.append({'name': name, 'grid': grid})
json.dump(sheets, open(sys.argv[2], 'w'), default=str)
PYEOF
fi

cd "$OUT" && node --test ./*.test.mjs
