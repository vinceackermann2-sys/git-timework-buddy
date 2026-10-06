'use strict';

// Only frame pixels captured from the real packaged app. Never reconstruct UI.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { Resvg } = require('@resvg/resvg-js');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'store-assets');
const logo = fs.readFileSync(path.join(root, 'assets/timewarp-logo.svg'), 'utf8')
  .replace(/^.*?<svg[^>]*>/s, '').replace(/<\/svg>\s*$/, '');
const font = path.join(output, 'fonts/quadrant-text-regular.ttf');
const specs = [
  { file: 'tools', number: '01', label: 'TOOLS', title: ['Your tools,', 'together.'], text: ['Connect apps from', 'one Timewarp workspace.'], accent: '#DFE9F5', imageWidth: 665, imageHeight: 849 },
  { file: 'agents', number: '02', label: 'AGENTS', title: ['Meet your', 'next agent.'], text: ['Choose a mascot, give it a name,', 'and define its responsibilities.'], accent: '#CCC5FF', imageWidth: 680, imageHeight: 864 },
  { file: 'models', number: '03', label: 'MODELS', title: ['Choose your', 'model.'], text: ['Find the model you want', 'in the app’s model selector.'], accent: '#B7D6FF', imageWidth: 710, imageHeight: 575 },
  { file: 'appearance', number: '04', label: 'APPEARANCE', title: ['Make it', 'yours.'], text: ['Twelve pastel themes.', 'One familiar Timewarp.'], accent: '#D6E5C8', imageWidth: 384, imageHeight: 868 },
];
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;');

async function main() {
  for (const spec of specs) {
    const source = path.join(output, 'captures', spec.file + '.png');
    const native = await sharp(source).resize(spec.imageWidth, spec.imageHeight, { fit: 'fill' }).png().toBuffer();
    const x = 850 + (1000 - spec.imageWidth) / 2;
    const y = 104 + (872 - spec.imageHeight) / 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1920" height="1080" viewBox="0 0 1920 1080">
      <rect width="1920" height="1080" fill="#f8f8f8"/>
      <g transform="translate(77 52) scale(.12)">${logo}</g>
      <text x="204" y="130" font-family="Segoe UI" font-size="44" font-weight="600" fill="#172033">Timewarp</text>
      <rect x="96" y="272" width="212" height="48" rx="24" fill="${spec.accent}"/>
      <text x="120" y="304" font-family="Segoe UI" font-size="20" font-weight="600" fill="#172033" letter-spacing="2">${spec.label}</text>
      ${spec.title.map((line, i) => `<text x="96" y="${455 + 101 * i}" font-family="Quadrant Text" font-size="86" fill="#172033">${escape(line)}</text>`).join('')}
      ${spec.text.map((line, i) => `<text x="100" y="${661 + 42 * i}" font-family="Segoe UI" font-size="28" fill="#596170">${escape(line)}</text>`).join('')}
      <rect x="850" y="72" width="1000" height="936" rx="32" fill="#fff" stroke="#e4e7eb" stroke-width="2"/>
      <image x="${x}" y="${y}" width="${spec.imageWidth}" height="${spec.imageHeight}" xlink:href="data:image/png;base64,${native.toString('base64')}"/>
      <text x="100" y="983" font-family="Segoe UI" font-size="21" fill="#79828b">Timewarp for Windows</text>
    </svg>`;
    const png = new Resvg(svg, { font: { fontFiles: [font], loadSystemFonts: true } }).render().asPng();
    fs.writeFileSync(path.join(output, `screenshot-${spec.number}.png`), png);
    console.log(`screenshot-${spec.number}.png: real ${spec.file} capture, 1920 x 1080`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
