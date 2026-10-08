# Timewarp model picker

The model control shows the selected model and thinking effort. Opening it
shows a continuous-drag thinking slider, a reset to the model's default effort, and a
model button. The model list shows every picker-visible model in catalog order,
with a check beside the selection. The controls use the active Timewarp palette
in light and dark mode. Dragging previews the nearest supported effort without
writing settings on each pointer move. Release commits once and settles at that
effort; arrows, Home and End select supported steps. Track clicks glide to the
nearest supported effort with a 240ms ease-out; the thumb and fill move together
using transforms. Grabbing the thumb preserves the pointer's offset, including
during an animation, and follows the pointer directly until release. Reduced
motion is respected.

On Free with a connected Codex account, the desktop reads every `model/list`
page. Hidden entries stay hidden, duplicate IDs are removed, and each model's
reasoning levels, speed tiers and defaults are retained. Timewarp credits keep
the Sol and Luna catalog with Standard speed. Changing models chooses the new
model's defaults; changing or resetting effort preserves speed. The speed control
appears only when the provider advertises extra tiers, using its labels and usage
descriptions. Native schemas retain opaque effort and tier ids (including Ultra
and priority), and requests validate saved choices against the current catalog.

All native packages use Codex's account-scoped remote discovery. The previous
`model_catalog_json` override is removed: a bundled catalog prevents remote
refresh and cannot establish account or plan eligibility. The renderer never
adds models or speed tiers from the bundled file or guesses access from a plan
name. OpenAI authorizes requests and enforces workspace restrictions and allowance.
Discovery is constrained by the installed app-server version; upgrading that
runtime may be necessary for newly released capabilities.

The bundled catalog's source, SHA256 and license are stored beside
`timewarp/shared/codex-models.json`. Update that catalog deliberately when
maintaining test fixtures. It is no longer injected into the runtime. Provider
metadata follows the [model/list protocol](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/app-server-protocol/schema/json/v2/ModelListResponse.json).
Cloud history retains effort and speed ids; the matching cloud function must be
deployed for this preservation to apply to remote sync.

Run from `timewarp` after building:

```powershell
npm run verify:model-picker
npm run verify:contracts
npm run verify:build
```

The picker verification uses the actual packaged picker and composer trigger
with isolated account and popover fixtures. It checks model selection, keyboard
navigation, eased track clicks, synchronized thumb and fill, pointer grab offset,
fractional dragging and single commit, release settling, reduced motion, speed
preservation, model-specific effort levels, reset, credit-catalog changes,
unavailable models and retry, disabled controls, narrow layout, and both themes.
Screenshots and results are written to ignored `timewarp/reports`.
