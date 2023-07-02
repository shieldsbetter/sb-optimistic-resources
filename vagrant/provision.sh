#!/bin/bash

if ! which envsubst &>/dev/null; then
	apt-get -yqq update
	apt-get install -yqq envsubst
fi

if ! which jw; then
	apt-get -yqq update
	apt-get install -yqq jq
fi

npm remove -g @shieldsbetter/pelton
cd /live-pelton
npm link