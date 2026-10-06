'use strict';
// Store logos are direct exports of the approved vector, never AI redraws.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { Resvg } = require('@resvg/resvg-js');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'store-assets');
const source = fs.readFileSync(path.join(root, 'assets/timewarp-logo.svg'), 'utf8');
const drawing = source.replace(/^.*?<svg[^>]*>/s, '').replace(/<\/svg>\s*$/, '');
function render(width, height) {
  // Use the same SVG canvas, geometry and alpha as the actual desktop icon.
  const size = Math.min(width, height);
  const x = (width - size) / 2, y = (height - size) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g transform="translate(${x} ${y}) scale(${size / 1024})">${drawing}</g></svg>`;
  return new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const tile = render(1080, 1080);
  for (const size of [300, 150, 71]) {
    await sharp(tile).resize(size, size).png().toFile(path.join(output, `logo-${size}.png`));
  }
  fs.writeFileSync(path.join(output, 'box-art-1080.png'), render(1080, 1080));
  fs.writeFileSync(path.join(output, 'poster-art-1440x2160.png'), render(1440, 2160));
  const manifest = [];
  for (const name of fs.readdirSync(output).filter(name => name.endsWith('.png'))) {
    const fullPath = path.join(output, name);
    const metadata = await sharp(fullPath).metadata();
    const stats = await sharp(fullPath).ensureAlpha().stats();
    const alpha = stats.channels[3];
    const isLogo = /^(logo-|box-art-|poster-art-)/.test(name);
    if (isLogo && (!metadata.hasAlpha || alpha.min !== 0)) {
      throw new Error(`${name} must preserve the approved logo's transparent background.`);
    }
    manifest.push({ file: name, width: metadata.width, height: metadata.height, bytes: fs.statSync(fullPath).size, format: metadata.format, hasAlpha: metadata.hasAlpha, alphaMin: alpha.min, alphaMax: alpha.max });
  }
  fs.writeFileSync(path.join(output, 'dimensions.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
