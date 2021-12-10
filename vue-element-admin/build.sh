#! /bin/env bash

set -e # exit when any command fails

PUBLIC_URL=/vue-element-admin/vue-element-admin npm install && npm run build:prod
mv -f vue-element-admin/dist ../public/vue-element-admin