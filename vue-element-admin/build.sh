#! /bin/env bash

set -e # exit when any command fails

PUBLIC_URL=/vue-element-admin/ npm install && npm run build:prod
mv -f dist ../public/vue-element-admin
