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

yarn
PUBLIC_URL=/create-react-app/ yarn run build
mv build "$PROJECT_DIST"
