"use strict";

const presets = [
  { name: "Pale lilac", hex: "#E9D2FF" },
  { name: "Ice blue", hex: "#B7D6FF" },
  { name: "Soft lime", hex: "#D8F3B0" },
  { name: "Warm cream", hex: "#FFE0A3" },
  { name: "Pink lilac", hex: "#E8B5F4" },
  { name: "Seafoam", hex: "#BCEBDD" },
  { name: "Lavender", hex: "#CCC5FF" },
  { name: "Powder rose", hex: "#FFD0DD" },
  { name: "Apricot", hex: "#FFD0B5" },
  { name: "Butter", hex: "#FFF0B8" },
  { name: "Cloud", hex: "#DFE9F5" },
  { name: "Glacier", hex: "#BAEBF5" },
  { name: "Mist sage", hex: "#D6E5C8" },
];

function hexToAccent(hex) {
  const [red, green, blue] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue), delta = max - min;
  const lightness = (max + min) / 2;
  let hue = 0;
  if (delta) {
    if (max === red) hue = 60 * ((green - blue) / delta % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  return { hue: hue < 0 ? hue + 360 : hue, saturation: delta ? Math.min(1, Math.max(0, delta / (1 - Math.abs(2 * lightness - 1)))) : 0, lightness, tint: 0.3 };
}

const defaultAccent = hexToAccent(presets[0].hex);
const stockAccent = hexToAccent("#82B1F0");
// Keep the existing stock-theme migration separate from the new-user default.
const legacyAccent = hexToAccent("#B7D6FF");
function migrateAppearance(appearance) {
  if (!appearance?.accent || !Object.keys(stockAccent).every(key => Math.abs(appearance.accent[key] - stockAccent[key]) < 1e-9)) return appearance;
  return { ...appearance, accent: { ...legacyAccent } };
}

module.exports = { presets, defaultAccent, hexToAccent, migrateAppearance };
