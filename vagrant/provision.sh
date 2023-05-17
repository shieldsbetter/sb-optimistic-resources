#!/bin/bash

if ! which envsubst &>/dev/null; then
	apt-get install -yqq envsubst
fi

npm remove -g @shieldsbetter/pelton
cd /live-pelton
npm link