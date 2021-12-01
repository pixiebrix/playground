#! /bin/bash

set -e # exit when any command fails

for DIR in */ ; do
	if [ "$DIR" = "public" ]
	then
		continue
	elif [ -f "$DIR/build.sh" ]
	then (
		echo "##################"
		echo "Running /${DIR}build.sh"
		echo "##################"
		cd "$DIR"
		bash ./build.sh
	)
	else
		echo "##################"
		echo "Moving /$DIR to /public/$DIR unchanged"
		mkdir -p "public/$DIR"
		mv "$DIR" "public/$DIR"
		echo "##################"
	fi
done
