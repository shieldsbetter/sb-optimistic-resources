#!/bin/bash

set -e

cd $(dirname "$0")

for image in $(echo "$SUPPORTED_MONGO_VERSIONS" | tr ',' ' '); do
    MONGO_IMAGE_TAG_DNS=$(echo $image | tr '.' '-')
    MONGO_CONNECT_STRING="mongodb://mongo-svc-${MONGO_IMAGE_TAG_DNS}.${PELTON_DEPENDENCY_SERVICE_DOMAIN}:27017"

    if [[ -n "$RUN_TESTS" ]]; then
        export RUN_TESTS="$RUN_TESTS;"
    fi

    export RUN_TESTS="$RUN_TESTS env MONGO_CONNECT_STRING=$MONGO_CONNECT_STRING npx ava"
done

>&2 echo "Run command: $RUN_TESTS"

cat test-runner.Dockerfile | envsubst