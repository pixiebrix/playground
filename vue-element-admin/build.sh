#! /bin/env bash

set -e # exit when any command fails

cd vue-element-admin

cp -R ../vue.config.js vue.config.js

npm install
PUBLIC_URL=/vue-element-admin npm run build:prod
mv -f dist ../../public/vue-element-admin