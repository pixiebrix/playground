#! /bin/env bash

set -e # exit when any command fails

cd repo

make install
make build
make build-demo

cd examples/demo


mv -f build ../../../../public/react-admin

