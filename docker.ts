#!/usr/bin/env bun
/**
 * Build & push llm-html image (latest + YYYYMMDDHHmm).
 *
 *   bun docker.ts
 */

const REPO = "docker.cnb.cool/qzsyzn/docker/llm-html";
const LATEST = `${REPO}:latest`;

const now = new Date();
const pad = (n: number) => String(n).padStart(2, "0");
const stamp = [
  now.getFullYear(),
  pad(now.getMonth() + 1),
  pad(now.getDate()),
  pad(now.getHours()),
  pad(now.getMinutes()),
].join("");
const TAGGED = `${REPO}:${stamp}`;

console.log(`Building ${LATEST} + ${TAGGED} ...`);
await Bun.$`docker build -t ${LATEST} -t ${TAGGED} .`.cwd(import.meta.dir);

console.log(`Pushing ${LATEST} ...`);
await Bun.$`docker push ${LATEST}`;

console.log(`Pushing ${TAGGED} ...`);
await Bun.$`docker push ${TAGGED}`;

console.log("Done.");
