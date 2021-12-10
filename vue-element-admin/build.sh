#! /bin/env bash

set -e # exit when any command fails

cd vue-element-admin
npm install
PUBLIC_URL=/vue-element-admin npm run build:prod
mv -f vue-element-admin/dist ../public/vue-element-admin