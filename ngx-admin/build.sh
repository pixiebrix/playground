#! /bin/env bash

set -e # exit when any command fails

cd repo

npm install
npm run build:prod

mv -f dist ../../public/ngx-admin

