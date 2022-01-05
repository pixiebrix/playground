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

# Set correct path
sed -i "s/publicPath: '\/'/publicPath: '\/vue-element-admin\/'/" vue.config.js

npm install
npm run build:prod
mv -f dist "$PROJECT_DIST"
