#! /bin/env bash

set -e # exit when any command fails

export PUBLIC_URL=/react-admin/

cd repo

make install
make build
make build-demo

mv -f examples/demo/build ../../public/react-admin

