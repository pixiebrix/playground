#! /bin/env bash

set -e # exit when any command fails

cd repo

# Set correct path
sed -i "s/publicPath: '\/'/publicPath: '\/vue-element-admin\/'/" vue.config.js

npm install
npm run build:prod
mv -f dist ../../public/vue-element-admin
