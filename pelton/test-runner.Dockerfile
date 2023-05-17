FROM node:16.17
COPY package*.json .

# If we're installed as a dependency via npm, we won't have access to
# package-lock.json, so we'll need to generate it.
RUN test -f package-lock.json || npm install

RUN npm ci

COPY . .
ENTRYPOINT []
CMD ["sh", "-c", "${RUN_TESTS}"]
