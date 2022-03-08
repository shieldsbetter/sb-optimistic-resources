# syntax=docker/dockerfile:1

FROM node:16

RUN apt -qqy update
RUN apt -qqy install netcat

RUN npm install -g ava c8

RUN mkdir /project
WORKDIR /project

COPY package.json .
COPY package-lock.json .
RUN npm ci

COPY . .

ENTRYPOINT []
CMD []
