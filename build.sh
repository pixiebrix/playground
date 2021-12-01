#! /bin/sh

# exit when any command fails
set -e

# /react-example
cd react-example
yarn
PUBLIC_URL=/react-example/ yarn run build
mv build ../public/react-example
