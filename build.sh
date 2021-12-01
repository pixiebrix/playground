#! /bin/sh

# exit when any command fails
set -e

# /index.html
npx markdown-styles@3.2.0 --layout github --input README.md --output public
mv public/README.html public/index.html

# /example
mv example public

# /react-example
cd react-example
yarn
yarn run build
mv build ../public/react-example
