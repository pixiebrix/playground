#! /bin/env bash
### PLAYGROUND INTRO START
set -e # exit when any command fails
readlinkf(){ perl -MCwd -le 'print Cwd::abs_path shift' "$1";} # cross-platform
THIS_DIR="$(readlinkf "${0%/*}")"
cd "$THIS_DIR"
PROJECT_NAME="$(basename "$THIS_DIR")"
PROJECT_DIST="$(readlinkf "../../public")/$PROJECT_NAME"
echo "Building '$PROJECT_NAME' into '$PROJECT_DIST'"
### PLAYGROUND INTRO END

npm install

rm -rf "$PROJECT_DIST"
mkdir -p "$PROJECT_DIST"

# Static demo pages + harness (pages/react/*.html lands in <dist>/react/)
cp -r pages/* "$PROJECT_DIST"/

# Vendored real jQueryInitialize bundles (pre-3.2.6 + 3.2.6)
node bundle.mjs "$PROJECT_DIST/vendor"
