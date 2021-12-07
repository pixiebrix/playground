#! /bin/env bash

set -e # exit when any command fails
npm install
PUBLIC_URL=/vue-element-admin/ npm run build:prod
mv dist ./public/vue-element-admin
