#! /bin/bash
# Unless you already have a server of choice, you can install browser-sync
# from npm, and run it with this script to launch a server just for the static sites.
browser-sync start --files static --server static --directory
