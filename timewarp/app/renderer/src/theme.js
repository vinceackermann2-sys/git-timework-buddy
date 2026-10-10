// Applies Settings → Colors: light/dark scheme, accent, radiance and texture.
const media = window.matchMedia("(prefers-color-scheme: dark)");
let current = null;

export function resolvedScheme(appearance) {
  if (appearance?.scheme === "dark" || appearance?.scheme === "light") return appearance.scheme;
  return media.matches ? "dark" : "light";
}

export function applyAppearance(appearance) {
  current = appearance || {};
  const root = document.documentElement;
  root.dataset.scheme = resolvedScheme(current);
  const accent = current.accent;
  if (accent && Number.isFinite(accent.hue)) {
    root.style.setProperty("--accent-h", String(Math.round(accent.hue)));
    root.style.setProperty("--accent-s", Math.round((accent.saturation ?? 1) * 100) + "%");
    root.style.setProperty("--accent-l", Math.round((accent.lightness ?? 0.9) * 100) + "%");
  }
  const radiance = Number(current.radiance);
  root.style.setProperty("--radiance", String(Number.isFinite(radiance) ? Math.min(1, Math.max(0, radiance)) : 0.5));
  const step = Number(current.texture?.step) || 0;
  document.body.dataset.texture = current.texture?.type === "dots" && step > 0 ? "dots" : "";
  root.style.setProperty("--texture-step", Math.max(6, step) + "px");
}

media.addEventListener("change", () => { if (current) applyAppearance(current); });
