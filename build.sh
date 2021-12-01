#! /bin/sh

# exit when any command fails
set -e

# /create-react-app
cd create-react-app
yarn
PUBLIC_URL=/create-react-app/ yarn run build
mv build ../public/create-react-app
