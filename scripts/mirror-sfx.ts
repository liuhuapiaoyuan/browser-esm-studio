/**
 * Download teaching SFX from demo/ss.html sources and upload to S3.
 * Prints manifest JSON to stdout.
 *
 * Usage: bun scripts/mirror-sfx.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, createHmac } from "node:crypto";

const enc = new TextEncoder();

const SOUNDS = [
  { id: "correct", name: "正确", icon: "✅", url: "https://1500019226.vod2.myqcloud.com/6cae817cvodcq1500019226/2a80caa25145403710609842828/iNP80ZzmvoAA.mp3" },
  { id: "wrong", name: "错误", icon: "❌", url: "https://1500019226.vod2.myqcloud.com/6cae817cvodcq1500019226/263bfa7b5145403701645834523/ITNlljUhLEcA.mp3" },
  { id: "fail", name: "失败", icon: "💔", url: "https://1500019226.vod2.myqcloud.com/6cae817cvodcq1500019226/43a37e525145403710606851014/FJgV0qoxdJ0A.mp3" },
  { id: "success", name: "成功", icon: "🏆", url: "https://1500019226.vod2.myqcloud.com/6cae817cvodcq1500019226/2315e6b85145403710586237321/RCswDltSIXoA.mp3" },
  { id: "cheer", name: "欢呼", icon: "🎉", url: "https://1500019226.vod2.myqcloud.com/6cae817cvodcq1500019226/17a09b145145403710609011376/gqWMQ3Fy1UwA.mp3" },
  { id: "oops", name: "啊欧", icon: "😳", url: "https://1500019226.vod2.myqcloud.com/6cae817cvodcq1500019226/56067d555145403710610306765/BVoJ6IrH2qcA.mp3" },
  { id: "ding", name: "叮叮", icon: "🔔", url: "https://1500019226.vod2.myqcloud.com/6cae817cvodcq1500019226/9b5855325145403710604206076/8K8OcUpwmFoA.mp3" },
  { id: "knock", name: "咚咚", icon: "🚪", url: "https://1500019226.vod2.myqcloud.com/6cae817cvodcq1500019226/ff57bf3d5145403710602147778/gkm26tizIhkA.mp3" },
  { id: "click", name: "点击", icon: "👆", url: "https://1500019226.vod2.myqcloud.com/6cae817cvodcq1500019226/089ade405145403710602538984/TgZ4XbmUZmkA.mp3" },
  { id: "got-it", name: "收到", icon: "👌", url: "https://1500019226.vod2.myqcloud.com/6cae817cvodcq1500019226/6c5f75155145403710600441757/rLZTS1hzVRQA.mp3" },
  { id: "warning", name: "警告", icon: "⚠️", url: "https://1500019226.vod2.myqcloud.com/6cae817cvodcq1500019226/1811d7025145403710589840436/4AzxjO5QazAA.mp3" },
  { id: "time-up", name: "时间到", icon: "⏰", url: "https://1500019226.vod2.myqcloud.com/6cae817cvodcq1500019226/8c42fff75145403710591156171/GhhWBk3dtl8A.mp3" },
  { id: "start", name: "开始", icon: "▶️", url: "https://1500019226.vod2.myqcloud.com/6cae817cvodcq1500019226/661460115145403710597699917/p3nDw8QjjXYA.mp3" },
  { id: "pause", name: "暂停", icon: "⏸️", url: "https://1500019226.vod2.myqcloud.com/6cae817cvodcq1500019226/4359b25f5145403710583561547/Qh9mi782Xi4A.mp3" },
  { id: "level-up", name: "升级", icon: "🆙", url: "https://1500019226.vod2.myqcloud.com/6cae817cvodcq1500019226/b0a6b5a95145403710598588308/9FnDB3oTLAgA.mp3" },
  { id: "coin", name: "金币", icon: "💰", url: "https://1500019226.vod2.myqcloud.com/6cae817cvodcq1500019226/338d0edd5145403710586955040/HTyaJ435L7QA.mp3" },
  { id: "applause", name: "掌声", icon: "👏", url: "https://1500019226.vod2.myqcloud.com/6cae817cvodcq1500019226/67d43f9b5145403710597711118/BUB7Tg3gz3IA.mp3" },
  { id: "thinking", name: "思考", icon: "🤔", url: "https://1500019226.vod2.myqcloud.com/6cae817cvodcq1500019226/79d378145145403710594400470/LlSRKt9XpogA.mp3" },
  { id: "question", name: "疑问", icon: "❓", url: "https://1500019226.vod2.myqcloud.com/6cae817cvodcq1500019226/72ea68e05145403710594118089/OTcFeVj0BH0A.mp3" },
  { id: "goodbye", name: "再见", icon: "👋", url: "https://1500019226.vod2.myqcloud.com/6cae817cvodcq1500019226/cb9cb1d65145403710595621025/0f1akjtlsGUA.mp3" },
] as const;

const S3_PREFIX = "sfx/teaching";

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

type UploadTarget = {
  putUrl: URL;
  host: string;
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
  body: Uint8Array;
  key: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  region: string;
}): Promise<string> {
  const contentType = "audio/mpeg";
  const payloadHash = sha256Hex(opts.body);
  const { amz, day } = amzDate();
  const service = "s3";
  const target = resolveUploadTarget(opts.endpoint, opts.bucket, opts.key);

  const headers: Record<string, string> = {
    host: target.host,
    "content-type": contentType,
    "content-length": String(opts.body.byteLength),
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amz,
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
    "",
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
    headers: { ...headers, Authorization: authorization },
    body: opts.body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`S3 PutObject failed HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  const cdn = optionalEnv("S3_CDN").replace(/\/+$/, "");
  return cdn ? `${cdn}/${opts.key}` : target.putUrl.toString();
}

async function main() {
  const bucket = requireEnv("S3_BUCKET_NAME");
  const accessKeyId = requireEnv("S3_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("S3_SECRET_ACCESS_KEY");
  const endpoint = requireEnv("S3_ENDPOINT");
  const region = requireEnv("S3_REGION");

  const tmpDir = join(import.meta.dir, ".sfx-tmp");
  mkdirSync(tmpDir, { recursive: true });

  const manifest: Array<{
    id: string;
    name: string;
    icon: string;
    url: string;
    key: string;
    byteLength: number;
  }> = [];

  for (const sound of SOUNDS) {
    const key = `${S3_PREFIX}/${sound.id}.mp3`;
    process.stderr.write(`downloading ${sound.id} (${sound.name})…\n`);
    const response = await fetch(sound.url);
    if (!response.ok) {
      throw new Error(`下载失败 ${sound.id}: HTTP ${response.status}`);
    }
    const body = new Uint8Array(await response.arrayBuffer());
    const localPath = join(tmpDir, `${sound.id}.mp3`);
    writeFileSync(localPath, body);

    process.stderr.write(`uploading ${key} (${body.byteLength} bytes)…\n`);
    const cdnUrl = await putObject({
      body,
      key,
      bucket,
      accessKeyId,
      secretAccessKey,
      endpoint,
      region,
    });

    manifest.push({
      id: sound.id,
      name: sound.name,
      icon: sound.icon,
      url: cdnUrl,
      key,
      byteLength: body.byteLength,
    });
    process.stderr.write(`  → ${cdnUrl}\n`);
  }

  const outPath = join(import.meta.dir, ".sfx-tmp", "manifest.json");
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stderr.write(`\nmanifest written: ${outPath}\n`);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
