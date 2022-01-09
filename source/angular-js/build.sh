#! /bin/env bash
### PLAYGROUND INTRO START
set -e # exit when any command fails
cd "$(dirname "${BASH_SOURCE[0]}")" # move to this script’s directory
THIS_DIR=$(pwd)
PROJECT_NAME="$(basename "$THIS_DIR")"
PROJECT_DIST="$(cd ../../public && pwd)/$PROJECT_NAME"
echo "Building '$PROJECT_NAME' into '$PROJECT_DIST'"
### PLAYGROUND INTRO END

cd repo
npm install
gulp build

mv -f .tmp/serve "$PROJECT_DIST"