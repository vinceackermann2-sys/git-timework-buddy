# Microsoft Store artwork

Corrected and saved on 2026-10-06 for the existing **TimeWarp Dev** product (`9N6WRN6GN0KR`), English (United States), **Submission 9** (`1152921505702057240`). Partner Center confirms **Store listings: Updated** and **Submission 9: In draft**. The artwork update has not been submitted for certification.

The five Store logo assets are transparent exports of `assets/timewarp-logo.svg`: 300, 150 and 71 pixel app tile icons, 1080 pixel square box art, and 1440 x 2160 poster art. The original geometry, purple and white strokes, and alpha are preserved. There is no background fill. `dimensions.json` records the decoded alpha range; the logo builder fails if transparency is lost.

The four 1920 x 1080 images contain actual native captures of the current packaged Timewarp desktop application. The image generation tool was not used for these replacements. The earlier generated artwork was replaced because it used outdated screenshot references and a visual style that did not match the app.

| File | Native view |
| --- | --- |
| screenshot-01.png | Tools catalog |
| screenshot-02.png | New Agent form with Orbit, Nova and Cosmo |
| screenshot-03.png | Open model selector |
| screenshot-04.png | Twelve Timewarp theme presets |

The approved SVG mark, Quadrant Text font bundled with the app, Windows Segoe UI, and pastel colors from the actual app palette frame these captures. The captured controls and text are preserved. Cropping excludes account emails, usage details, and private drafts; no real message was sent and no agent was created. Temporary app zoom was restored after capture. The safe crops are retained in `captures/` for reproducibility. Native capture JPEG pixels are exported to PNG and composed directly; no interface elements are generated or redrawn.

Rebuild the images and then the logos and complete dimension/alpha manifest:

```powershell
node scripts/build-store-screenshots.cjs
node scripts/build-store-artwork.cjs
```

The uncropped captures remain only in the ignored local `reports/store-native-captures/` folder. Do not publish those raw captures because they include account information outside the final crop boundaries.

Saved-listing proof: `reports/store-artwork-corrected-listing.jpg`, `reports/store-artwork-corrected-logos.jpg`, and `reports/store-artwork-corrected-overview.jpg`.
