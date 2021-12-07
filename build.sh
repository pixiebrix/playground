#! /bin/bash

set -e # exit when any command fails

###################################################
# This script is executed by vercel on deployment #
###################################################

mkdir -p public
mv ./-go-to-repo.html public

for DIR in */ ; do
	if [ "$DIR" = "public/" ]
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
	elif [ "$DIR" = "vue-element-admin/" ]
	then(
		echo "##################"
		echo "Running /${DIR}build.sh"
		echo "##################"
		cd "$DIR"
		touch builds.sh
		cp ../vuebuild.sh builds.sh
		bash ./build.sh
	)
	else
		echo "##################"
		echo "Moving /$DIR to /public/$DIR unchanged"
		mkdir -p "public/$DIR"
		mv "$DIR" public/
		echo "##################"
	fi
done
