FROM node:16.17
COPY package.json package-lock.json .
RUN npm ci
COPY . .
ENTRYPOINT ["npx", "ava"]
CMD []
