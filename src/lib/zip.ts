import type { FileMap } from "../types";

const encoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function push16(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function push32(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function createZip(files: FileMap): Blob {
  const local: BlobPart[] = [];
  const central: BlobPart[] = [];
  let offset = 0;
  const timestamp = dosDateTime();

  for (const [path, source] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const name = encoder.encode(path);
    const data = encoder.encode(source);
    const crc = crc32(data);
    const header: number[] = [];

    push32(header, 0x04034b50);
    push16(header, 20);
    push16(header, 0x0800);
    push16(header, 0);
    push16(header, timestamp.time);
    push16(header, timestamp.date);
    push32(header, crc);
    push32(header, data.length);
    push32(header, data.length);
    push16(header, name.length);
    push16(header, 0);
    local.push(new Uint8Array(header), name, data);

    const directory: number[] = [];
    push32(directory, 0x02014b50);
    push16(directory, 20);
    push16(directory, 20);
    push16(directory, 0x0800);
    push16(directory, 0);
    push16(directory, timestamp.time);
    push16(directory, timestamp.date);
    push32(directory, crc);
    push32(directory, data.length);
    push32(directory, data.length);
    push16(directory, name.length);
    push16(directory, 0);
    push16(directory, 0);
    push16(directory, 0);
    push16(directory, 0);
    push32(directory, 0);
    push32(directory, offset);
    central.push(new Uint8Array(directory), name);

    offset += header.length + name.length + data.length;
  }

  const centralSize = central.reduce((sum, item) => sum + (item as Uint8Array).length, 0);
  const end: number[] = [];
  push32(end, 0x06054b50);
  push16(end, 0);
  push16(end, 0);
  push16(end, Object.keys(files).length);
  push16(end, Object.keys(files).length);
  push32(end, centralSize);
  push32(end, offset);
  push16(end, 0);

  return new Blob([...local, ...central, new Uint8Array(end)], { type: "application/zip" });
}

export function downloadProjectZip(files: FileMap, filename = "project.zip") {
  const blob = createZip(files);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
