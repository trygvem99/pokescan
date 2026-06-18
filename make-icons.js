// Generates icon-192.png and icon-512.png (a Poké Ball on red) with zero deps.
// Draws pixels directly and encodes PNG via Node's built-in zlib.
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function png(N) {
  const RED = [179, 0, 27], WHITE = [255, 255, 255], BLACK = [26, 26, 31];
  const cx = N / 2, cy = N / 2;
  const R = N * 0.42, band = N * 0.05, btn = N * 0.13;

  const raw = Buffer.alloc(N * (N * 3 + 1));
  let p = 0;
  for (let y = 0; y < N; y++) {
    raw[p++] = 0; // filter byte: none
    for (let x = 0; x < N; x++) {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
      let col = RED;
      if (d <= R) {
        if (d <= btn) col = d > btn * 0.58 ? BLACK : WHITE; // center button + ring
        else if (Math.abs(dy) <= band) col = BLACK;         // equator band
        else if (dy < 0) col = RED;                         // top half
        else col = WHITE;                                   // bottom half
      }
      raw[p++] = col[0]; raw[p++] = col[1]; raw[p++] = col[2];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0);
  ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor RGB
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  const out = path.join(__dirname, `icon-${size}.png`);
  fs.writeFileSync(out, png(size));
  console.log(`wrote ${out}`);
}
