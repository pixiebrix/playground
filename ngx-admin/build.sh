#! /bin/env bash

set -e # exit when any command fails

cd repo

npm install
npm run build:prod

sed -i "s/<base href='/'> <base href='/ngx-admin/'>" dist/index.html

mv -f dist ../../public/ngx-admin

