#!/bin/bash

set -e

cd $(dirname "$0")

>&2 echo "PELTON_EXTRA_ARGS=$PELTON_EXTRA_ARGS"
>&2 AVA_ARGS=$(echo "$PELTON_EXTRA_ARGS" | jq '.[]' | tr '\n' ' ')
>&2 echo "AVA_ARGS=$AVA_ARGS"

for image in $(echo "$SUPPORTED_MONGO_VERSIONS" | tr ',' ' '); do
    MONGO_IMAGE_TAG_DNS=$(echo $image | tr '.' '-')
    MONGO_CONNECT_STRING="mongodb://mongo-svc-${MONGO_IMAGE_TAG_DNS}.${PELTON_DEPENDENCY_SERVICE_DOMAIN}:27017"

    if [[ -n "$RUN_TESTS" ]]; then
        export RUN_TESTS="$RUN_TESTS;"
    fi

    export RUN_TESTS="$RUN_TESTS env MONGO_CONNECT_STRING=$MONGO_CONNECT_STRING npx ava $AVA_ARGS"
done

>&2 echo "Run command: $RUN_TESTS"

export RUN_TESTS=$(jq -n --arg x "$RUN_TESTS" '$x')

cat test-runner.Dockerfile | envsubst