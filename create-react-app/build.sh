#! /bin/sh

set -e # exit when any command fails

yarn
PUBLIC_URL=/create-react-app/ yarn run build
mv build ../public/create-react-app
