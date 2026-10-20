#!/bin/sh
# Run every node suite in scripts/ (*.test.mjs) — the traverse model + generator tests and every newer one.
#
# Firestore enforces App Check and the app is behind a PIN gate, so nothing can drive the real app
# from a script — pure modules + node tests are the only verification available for this feature.
# EVERY SUITE READS THE APP'S OWN FILES where they live ('../src/components/…js', through
# scripts/_lib/extless-hook.mjs for the CRA files that leave ".js" off) and runs from the REPO ROOT.
# (2026-10-20: the traverse family used to run from .mjs copies staged here, their imports rewritten by
# sed — once two modules imported './traverseExplode.js' and './nodeList.js' the copies could not load,
# and those six suites had stopped running. They read the source now, like every newer suite.)
#
#   sh scripts/run-traverse-tests.sh
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

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

# (KIT_SHEET names the extracted sheet for the suites that read it)
if [ -f "$OUT/kit_sheet.json" ]; then KIT_SHEET="$OUT/kit_sheet.json"; export KIT_SHEET; fi
cd "$ROOT" && node --test scripts/*.test.mjs
