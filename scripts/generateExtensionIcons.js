const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const rootDir = path.resolve(__dirname, "..");
const iconDir = path.join(rootDir, "src", "icons");
const sizes = [16, 32, 48, 128, 256, 512, 1024];

fs.mkdirSync(iconDir, { recursive: true });

for (const size of sizes) {
  fs.writeFileSync(path.join(iconDir, `icon-${size}.png`), createIconPng(size));
}

console.log(`Generated ${sizes.length} extension icons in src/icons.`);

function createIconPng(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = Math.round(size * 0.19);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const inside = isInsideRoundedRect(x, y, size, radius);
      const color = inside ? [36, 107, 254, 255] : [0, 0, 0, 0];
      pixels.set(color, offset);
    }
  }

  drawRect(pixels, size, 0.22, 0.26, 0.56, 0.12, [255, 255, 255, 255]);
  drawRect(pixels, size, 0.42, 0.26, 0.14, 0.48, [255, 255, 255, 255]);
  drawRect(pixels, size, 0.32, 0.78, 0.36, 0.06, [215, 227, 255, 255]);
  drawRect(pixels, size, 0.36, 0.86, 0.28, 0.045, [215, 227, 255, 255]);

  const rawRows = [];
  for (let y = 0; y < size; y += 1) {
    rawRows.push(Buffer.from([0]));
    rawRows.push(pixels.subarray(y * size * 4, (y + 1) * size * 4));
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    createChunk("IHDR", Buffer.concat([
      uint32(size),
      uint32(size),
      Buffer.from([8, 6, 0, 0, 0])
    ])),
    createChunk("IDAT", zlib.deflateSync(Buffer.concat(rawRows))),
    createChunk("IEND", Buffer.alloc(0))
  ]);
}

function isInsideRoundedRect(x, y, size, radius) {
  const max = size - 1;
  const left = x < radius;
  const right = x > max - radius;
  const top = y < radius;
  const bottom = y > max - radius;

  if ((left || right) && (top || bottom)) {
    const cx = left ? radius : max - radius;
    const cy = top ? radius : max - radius;
    return Math.hypot(x - cx, y - cy) <= radius;
  }

  return true;
}

function drawRect(pixels, size, xRatio, yRatio, widthRatio, heightRatio, color) {
  const xStart = Math.round(size * xRatio);
  const yStart = Math.round(size * yRatio);
  const xEnd = Math.round(size * (xRatio + widthRatio));
  const yEnd = Math.round(size * (yRatio + heightRatio));

  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      const offset = (y * size + x) * 4;
      pixels.set(color, offset);
    }
  }
}

function createChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const crcInput = Buffer.concat([typeBuffer, data]);
  return Buffer.concat([
    uint32(data.length),
    typeBuffer,
    data,
    uint32(crc32(crcInput))
  ]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
