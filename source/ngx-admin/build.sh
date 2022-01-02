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
npm run build:prod

sed -i "5d" dist/index.html
sed -i "5s/$/ <base href='\/ngx-admin\/'>/" dist/index.html

mv -f dist "$PROJECT_DIST"
