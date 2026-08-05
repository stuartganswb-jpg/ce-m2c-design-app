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

for f in traverseTags traverseFlow; do
    sed "s#from '\./traverseTags'#from './traverseTags.mjs'#" "$ROOT/src/components/Shared/$f.js" > "$OUT/$f.mjs"
done
cp "$ROOT"/scripts/*.test.mjs "$OUT/"

cd "$OUT" && node --test ./*.test.mjs
