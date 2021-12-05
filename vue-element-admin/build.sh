#! /bin/sh

set -e # exit when any command fails

yarn
PUBLIC_URL=/vue-element-admin/ yarn run build:prod
mv dist ../public/vue-element-admin


