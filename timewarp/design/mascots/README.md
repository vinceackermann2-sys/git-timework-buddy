# Mascots

Orbit, Nova and Cosmo are built procedurally in Blender by `mascots.py`.

| Mascot | Look | Loop |
| --- | --- | --- |
| Orbit | Pocket planet with a nebula-marble skin, one big eye, a tilted ring and two moons | Bobs, moons circle the ring, antenna bulb pulses, blinks |
| Nova | Plush star whose tips glow, with a comet in orbit | Wobbles and breathes, tips pulse, comet circles, blinks |
| Cosmo | Alien cadet in a glass bubble helmet with glowing antennae | Waves, antennae sway and pulse, blinks |

Every motion repeats exactly every 48 frames (2 s at 24 fps), so the loop is seamless.

## Rebuild

With Blender 5.1+ and ffmpeg installed:

```bash
design/mascots/render-all.sh        # renders render/<name>/frame_*.png and <name>_badge.png
node scripts/build-mascots.cjs      # writes assets/mascots/*.png and icons/
npm test                            # checks the avatars are looping animations
```

`source/*.blend` holds the generated scenes for hand editing; re-running
`mascots.py` overwrites them.

## Outputs

- `assets/mascots/<name>.png`: the 256 px animated avatar (APNG) used by the app.
  It is square and transparent, and its first frame is the still image, so it
  reads at the 14–80 px avatar sizes and in viewers that don't animate.
- `icons/<name>/`: static icons at 16–512 px plus a multi-size `.ico`, in two
  variants. Plain `<name>-<size>.png` is transparent. `<name>-badge-<size>.png`
  sits on a deep-space disc and works on any background.
