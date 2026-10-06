"use strict";
// Packs the Blender renders from design/mascots/render into the shipped
// animated avatars (assets/mascots/*.png, APNG) and the static icon sets.
// Requires ffmpeg on PATH. Render first with design/mascots/render-all.sh.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { packIco, sizes } = require('./build-icons.cjs');

const names = ['orbit', 'nova', 'cosmo'];
const root = path.resolve(__dirname, '..');
const renders = path.join(root, 'design/mascots/render');
const avatarSize = 256, fps = 24;
// Scale with premultiplied alpha so transparent edges keep their colour.
const scale = size => `premultiply=inplace=1,scale=${size}:${size}:flags=lanczos,unpremultiply=inplace=1`;

function ffmpeg(args) {
  cp.execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: 'inherit', windowsHide: true });
}

function buildMascots() {
  for (const name of names) {
    const frames = path.join(renders, name);
    if (!fs.existsSync(path.join(frames, 'frame_0001.png'))) throw new Error(`Render ${name} first (design/mascots/render-all.sh).`);
    const avatar = path.join(root, 'assets/mascots', name + '.png');
    ffmpeg(['-framerate', String(fps), '-i', path.join(frames, 'frame_%04d.png'), '-vf', scale(avatarSize),
      '-pix_fmt', 'rgba', '-plays', '0', '-f', 'apng', avatar]);
    const icons = path.join(root, 'design/mascots/icons', name);
    fs.mkdirSync(icons, { recursive: true });
    for (const [variant, source] of [['', path.join(frames, 'frame_0001.png')], ['-badge', path.join(renders, name + '_badge.png')]]) {
      const pngs = [...sizes, 512].map(size => {
        const file = path.join(icons, `${name}${variant}-${size}.png`);
        ffmpeg(['-i', source, '-vf', scale(size), '-pix_fmt', 'rgba', '-frames:v', '1', '-update', '1', file]);
        return fs.readFileSync(file);
      });
      fs.writeFileSync(path.join(icons, `${name}${variant}.ico`), packIco(pngs.slice(0, sizes.length), sizes));
    }
    console.log(`${name}: ${(fs.statSync(avatar).size / 1024).toFixed(0)} KB animated avatar, ${sizes.length + 1} icon sizes x 2 variants`);
  }
}

module.exports = { buildMascots, names };
if (require.main === module) buildMascots();
