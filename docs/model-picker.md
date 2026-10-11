# Timewarp model picker

The engine's picker is `timewarp/app/renderer/src/components/ModelPicker.jsx`,
ported from the previous app's picker (`timewarp/desktop/model-picker.cjs`) with
the behaviour below; the catalog and saved choices are in
`timewarp/app/main/model-catalog.cjs`, and `tests/engine-models.test.cjs` checks
them. The verification commands at the end check the previous app's build.

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
reasoning levels, speed tiers and defaults are retained. Timewarp credits list
Timewarp's models (`shared/models.cjs`), most intelligent first: on paid plans
Claude Opus 5.5, Claude Sonnet 5.5, Claude Fable 5.1, GPT-6 Astra, GPT-6.1 Sol
(the default), Claude Haiku 5.5 and GPT-6 Luna; on Free GPT-5.6 Sol and Luna.
Each of these rows shows three percentages with a bar, 100% being the best of
all Timewarp's models so they mean the same on every plan, from Artificial
Analysis's benchmarks at each model's highest effort
(`shared/model-benchmarks.json`):
- Intelligence: the average share of the best score across all thirteen
  evaluations every current model has (the ten in the Intelligence Index, plus
  Harvey LAB, MLCR and Terminal-Bench Science; the two Elo ratings count as
  twice the expected score against the best). GPT-5.6, which Artificial Analysis
  no longer evaluates, is placed by its Intelligence Index.
- Speed: the average of output speed, time to first token and time per task
  (output tokens over output speed, so a fast but wordy model isn't counted as
  quick), each as a share of the best.
- Low cost: the average of the blended price per million tokens and the cost per
  task, each on a log scale from the cheapest (1) to the priciest (0.1), since
  prices span 100x.

Each score is shown as a percentage of the best model's. Codex's catalog shows
no scores.
Each offers Low to Max thinking with its own default. Claude Opus 5.5 and the
GPT-6 models also have Fast at twice the credits (Anthropic's Fast mode, Azure's
priority processing; a request Azure serves at the standard speed costs the
standard rate); the others are Standard only. Changing models
chooses the new model's defaults, except that Fast stays on when the new model offers it;
changing or resetting effort preserves speed. The speed control appears only
when the provider advertises extra tiers, using its labels and usage
descriptions.

The bolt beside the effort is the Fast switch. For a model with a Fast tier
(Codex lists it as `priority`, named "Fast") it turns Fast on and off, keeping
the effort; it is lit while Fast is on, and the Speed buttons follow it. Fast
has its own blue: the bolt pops and glows, the thinking slider's fill turns blue
with sparkles streaming backwards through it and a flash sweeping across as Fast
turns on, and the Fast button and the trigger's "⚡ Fast" turn blue too (still
for reduced motion). The trigger names no speed for Standard. Models
without a Fast tier, such as GPT-5.6 on Free and every Claude model but Opus
5.5, show the bolt dimmed and inert, with a tooltip saying Fast isn't
available. The chosen tier is sent as `serviceTier` on each `turn/start`; Codex
sends `service_tier: "priority"` to the model and drops it again when a later
turn sends `null`. Codex forwards a tier only for models in its own catalog, so
Claude Opus 5.5 in Fast mode goes to Codex as `anthropic/claude-opus-5-5-fast`
(`codexModelName` in `shared/models.cjs`), which the cloud reads back.
`tests/engine-model-picker.test.cjs` renders the picker and checks this. Native schemas retain opaque effort and tier ids (including Ultra
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
