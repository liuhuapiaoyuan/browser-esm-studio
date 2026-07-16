/**
 * Upload a local file to S3-compatible storage (Aliyun OSS / etc.) and print the CDN URL.
 *
 * Usage:
 *   bun scripts/upload-s3.ts <file> [objectKey]
 *
 * Env (from .env):
 *   S3_BUCKET_NAME
 *   S3_ACCESS_KEY_ID
 *   S3_SECRET_ACCESS_KEY
 *   S3_ENDPOINT
 *   S3_REGION
 *   S3_CDN          optional public base; falls back to upload URL origin
 *
 * Example:
 *   bun scripts/upload-s3.ts ./icon.png skill-icons/sandbox.png
 */

import { createHash, createHmac } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";

const enc = new TextEncoder();

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function optionalEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function amzDate(date = new Date()): { amz: string; day: string } {
  const iso = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return { amz: iso, day: iso.slice(0, 8) };
}

function guessContentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function sanitizeKey(raw: string): string {
  return raw
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
}

function defaultObjectKey(filePath: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const name = basename(filePath).replace(/[^\w.\-]+/g, "_");
  return `uploads/${stamp}-${name}`;
}

type UploadTarget = {
  /** Absolute URL used for PutObject */
  putUrl: URL;
  /** Host header / signed host */
  host: string;
  /** Canonical URI path (starts with /) */
  canonicalUri: string;
};

function resolveUploadTarget(endpoint: string, bucket: string, key: string): UploadTarget {
  const base = new URL(endpoint.includes("://") ? endpoint : `https://${endpoint}`);
  const hostHasBucket =
    base.hostname === bucket ||
    base.hostname.startsWith(`${bucket}.`) ||
    base.hostname.endsWith(`.${bucket}`);

  if (hostHasBucket) {
    const putUrl = new URL(`/${key}`, base);
    return {
      putUrl,
      host: putUrl.host,
      canonicalUri: `/${key.split("/").map(encodeURIComponent).join("/")}`,
    };
  }

  // Path-style: https://s3.region.example.com/bucket/key
  const putUrl = new URL(`/${bucket}/${key}`, base);
  return {
    putUrl,
    host: putUrl.host,
    canonicalUri: `/${[bucket, ...key.split("/")].map(encodeURIComponent).join("/")}`,
  };
}

function signingKey(secret: string, day: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, day);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

async function putObject(opts: {
  filePath: string;
  key: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  region: string;
}): Promise<{ putUrl: string; etag: string | null }> {
  const body = readFileSync(opts.filePath);
  const contentType = guessContentType(opts.filePath);
  const payloadHash = sha256Hex(body);
  const { amz, day } = amzDate();
  const service = "s3";
  const target = resolveUploadTarget(opts.endpoint, opts.bucket, opts.key);

  const headers: Record<string, string> = {
    host: target.host,
    "content-type": contentType,
    "content-length": String(body.byteLength),
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amz,
    // Public-read so CDN / direct URL can serve the object without signed GET.
    "x-amz-acl": "public-read",
  };

  const signedHeaderNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${headers[name]!.trim()}\n`)
    .join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = [
    "PUT",
    target.canonicalUri,
    "", // no query
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${day}/${opts.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amz,
    credentialScope,
    sha256Hex(enc.encode(canonicalRequest)),
  ].join("\n");

  const signature = createHmac("sha256", signingKey(opts.secretAccessKey, day, opts.region, service))
    .update(stringToSign, "utf8")
    .digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(target.putUrl, {
    method: "PUT",
    headers: {
      ...headers,
      Authorization: authorization,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `S3 PutObject failed HTTP ${response.status}: ${text.slice(0, 500) || response.statusText}`,
    );
  }

  return {
    putUrl: target.putUrl.toString(),
    etag: response.headers.get("etag"),
  };
}

function publicUrl(cdn: string, key: string, putUrl: string): string {
  const base = cdn.replace(/\/+$/, "");
  if (base) return `${base}/${key}`;
  return putUrl;
}

function printHelp(): never {
  console.log(`Usage:
  bun scripts/upload-s3.ts <file> [objectKey]

Env:
  S3_BUCKET_NAME, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
  S3_ENDPOINT, S3_REGION, S3_CDN (optional)

Example:
  bun scripts/upload-s3.ts ./icon.png skill-icons/sandbox.png`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    printHelp();
  }

  const filePath = args[0]!;
  const key = sanitizeKey(args[1] ?? defaultObjectKey(filePath));

  try {
    const st = statSync(filePath);
    if (!st.isFile()) throw new Error(`不是文件: ${filePath}`);
  } catch (error) {
    throw new Error(`无法读取文件: ${filePath}${error instanceof Error ? ` (${error.message})` : ""}`);
  }

  const bucket = requireEnv("S3_BUCKET_NAME");
  const accessKeyId = requireEnv("S3_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("S3_SECRET_ACCESS_KEY");
  const endpoint = requireEnv("S3_ENDPOINT");
  const region = requireEnv("S3_REGION");
  const cdn = optionalEnv("S3_CDN");

  const result = await putObject({
    filePath,
    key,
    bucket,
    accessKeyId,
    secretAccessKey,
    endpoint,
    region,
  });

  const url = publicUrl(cdn, key, result.putUrl);
  // One line URL for piping; details on stderr.
  console.error(`uploaded ${filePath} → ${key}${result.etag ? ` etag=${result.etag}` : ""}`);
  console.log(url);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
