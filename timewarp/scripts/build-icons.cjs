"use strict";
const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');
const sharp = require('sharp');

const sizes = [16, 20, 24, 28, 32, 40, 48, 56, 64, 96, 128, 256];
let cachedSource = null, cachedPng = null;

function desktopIconSvg(source) {
  // Desktop icons keep the approved transparent artwork without a background tile.
  return source;
}

function exportSourcePng(source) {
  if (source !== cachedSource) {
    cachedPng = new Resvg(desktopIconSvg(source), {
      fitTo: { mode: 'width', value: 1024 }, font: { loadSystemFonts: false }
    }).render().asPng();
    cachedSource = source;
  }
  return cachedPng;
}

async function renderIcon(source, size) {
  // Export the desktop SVG once, then resize that exact PNG for every frame.
  // All sizes keep the same drawing, colors, stroke widths and composition.
  const png = exportSourcePng(source);
  return size === 1024 ? png : sharp(png).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
}

function packIco(images, iconSizes) {
  const header = Buffer.alloc(6 + iconSizes.length * 16);
  header.writeUInt16LE(1, 2); // Windows icon, with PNG-compressed RGBA frames.
  header.writeUInt16LE(iconSizes.length, 4);
  let offset = header.length;
  images.forEach((png, i) => {
    const entry = 6 + i * 16;
    header[entry] = iconSizes[i] === 256 ? 0 : iconSizes[i];
    header[entry + 1] = header[entry];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images]);
}

function packIcns(images) {
  const entries = images.map(({ type, png }) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(8 + png.length, 4);
    return Buffer.concat([header, png]);
  });
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(8 + entries.reduce((sum, entry) => sum + entry.length, 0), 4);
  return Buffer.concat([header, ...entries]);
}

async function buildIcons() {
  const assets = path.resolve(__dirname, '../assets');
  const source = fs.readFileSync(path.join(assets, 'timewarp-logo.svg'), 'utf8');
  const pngSizes = [...sizes, 512, 1024];
  const images = await Promise.all(pngSizes.map(size => renderIcon(source, size)));
  const bySize = new Map(pngSizes.map((size, i) => [size, images[i]]));
  const pngFolder = path.join(assets, 'icons');
  fs.mkdirSync(pngFolder, { recursive: true });
  pngSizes.forEach((size, i) => {
    fs.writeFileSync(path.join(pngFolder, `app-icon-${size}.png`), images[i]);
  });
  fs.writeFileSync(path.join(assets, 'app-icon.svg'), desktopIconSvg(source));
  fs.writeFileSync(path.join(assets, 'app-icon.ico'), packIco(sizes.map(size => bySize.get(size)), sizes));
  fs.writeFileSync(path.join(assets, 'app-icon.png'), bySize.get(1024));
  const macFrames = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];
  fs.writeFileSync(path.join(assets, 'app-icon.icns'), packIcns(macFrames.map(([type, size]) => ({ type, png: bySize.get(size) }))));
  console.log('Built transparent desktop icons (Windows ICO, macOS ICNS and PNG) from the unchanged in-app SVG.');
}

module.exports = { buildIcons, renderIcon, desktopIconSvg, packIco, packIcns, sizes };
if (require.main === module) buildIcons().catch(error => { console.error(error.message); process.exitCode = 1; });
