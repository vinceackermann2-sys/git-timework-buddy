# Timewarp landing page

A standalone, responsive one-page website for independent marketing consultants. It uses the existing Timewarp logo and mascot exports. The product demonstration is clearly labeled as illustrative: it is an interactive explanation, not a live connection to the desktop agent.

Run the local preview with `node preview.cjs`, then open `http://127.0.0.1:4178`.

The deployable files are in `dist/`; there are no build dependencies. The design mirrors the desktop app: the logo purple `#8C14FF` and its tints, ink `#172033`, the system font, and the app's display font Quadrant Text (`dist/assets/fonts`, copied from the app build; confirm its license covers web use before publishing). The animated mascots in `dist/assets/*.webp` are compressed from the app's APNGs in `timewarp/assets/mascots`. `dist/download.js` holds OS detection and downloads; `dist/app.js` drives the animations. Run `node verify.cjs` after changing either download file.

## Installer links

Set the two values in `dist/download-config.js` to the official HTTPS installer URLs:

```js
window.TIMEWARP_DOWNLOADS = Object.freeze({
  windows: 'https://your-official-host/Timewarp-Setup.exe',
  mac: 'https://your-official-host/Timewarp.dmg'
});
```

Those are syntax examples, not real Timewarp downloads. Until URLs are supplied, the actual configuration contains `null` and displays a coming-soon dialog.

- Windows and Mac desktop visitors get the matching primary button (with OS icon) and an "Also for macOS/Windows" link for the other platform.
- Mobile, iPad, Linux, and unknown browsers get a platform chooser.
- iPads reporting themselves as Mac are excluded using touch-point detection.
- A platform with no URL shows an honest unavailable state; it never navigates to a fake installer.
- Only valid HTTPS URLs are accepted.
- No email collection, tracking, or fabricated download confirmation is included.

The page's content and download links can be edited independently of the desktop application. Website work does not change the app source or its authentication routes.

## Legal pages and cookie consent

`dist/legal/` holds the Privacy Policy, Terms of Service and Cookie Policy. Routes in `src/routes/legal.*.tsx` serve them at `/legal/privacy-policy`, `/legal/terms-of-service` and `/legal/cookie-policy`. The desktop app's sign-up form and the account emails already link to the first two. Every page's footer links to all three plus Cookie settings. Update the "Last updated" date when the text changes.

The site itself sets no tracking cookies, but Lovable's hosting adds its own analytics to every published page: `~flock.js` sets a 30-minute `session-id` cookie, and the `__l5e` events SDK sends page views. `dist/consent.js` loads first, without `defer`. It holds that cookie and those requests in memory until the visitor clicks Accept, and drops them on Reject. Reject and Accept get equal weight, the choice is kept for 12 months, Global Privacy Control counts as a rejection, and any element with `data-cookie-settings` reopens the banner. The TanStack sign-in pages load the same guard with `data-banner="off"`. If Lovable changes its analytics paths or cookie, update `PATHS` and `COOKIE` in `consent.js` and the Cookie Policy. `src/test/consent.test.ts` covers the guard.

## Messaging decisions

See `audience-research.md` for the chosen persona, evidence, assumptions, and how the requested marketing criteria map to the page.
