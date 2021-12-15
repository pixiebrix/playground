#! /bin/env bash

set -e # exit when any command fails

PUBLIC_URL=/react-admin/

cd repo

make install
make build
make build-demo

cd examples/demo


mv -f build ../../../../public/react-admin

