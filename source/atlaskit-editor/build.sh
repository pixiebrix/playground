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

# Not `npm ci`: @atlaskit/feature-gate-js-client has an optional dependency on the Atlassian-internal
# @atlassiansox/analytics-web-client, which npm can't resolve or record, and `ci` rejects the lockfile.
npm install

rm -rf "$PROJECT_DIST"
mkdir -p "$PROJECT_DIST"

# @atlaskit/media-card imports a subpath @atlaskit/media-svg@3.3.0 doesn't publish; `errors` is
# the same module. media-svg is pinned exactly so a bump fails here instead of aliasing silently.
#
# Atlassian's packages assume a bundler that shims Node builtins and reads `process`, so
# events/buffer/string_decoder are installed as browser shims and `process` is defined outright.
npx esbuild entry.js \
	--bundle \
	--format=esm \
	--target=es2022 \
	--minify \
	--define:process.env.NODE_ENV='"production"' \
	--banner:js='globalThis.process ??= { env: { NODE_ENV: "production" } };' \
	--alias:@atlaskit/media-svg/media-svg-error=@atlaskit/media-svg/errors \
	--loader:.svg=dataurl \
	--loader:.png=dataurl \
	--outfile="$PROJECT_DIST/atlaskit-editor.js"
