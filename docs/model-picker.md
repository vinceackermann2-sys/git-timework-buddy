# Timewarp model picker

The model control shows the selected model and thinking effort. Opening it
shows a discrete thinking slider, a reset to the model's default effort, and a
model button. The model list shows every picker-visible model in catalog order,
with a check beside the selection. The controls use the active Timewarp palette
in light and dark mode.

On Free with a connected Codex account, the desktop reads every `model/list`
page. Hidden entries stay hidden, duplicate IDs are removed, and each model's
reasoning levels and default are retained. Timewarp credits keep the Sol and
Luna catalog. Changing the model chooses its default thinking level. The native
settings schemas accept Ultra as well as the older effort values.

The supplied Codex app-server package reports `0.0.0`, which receives an older
remote catalog. For that package only, `shared/codex-catalog.cjs` supplies the
complete, unmodified OpenAI catalog from Codex `rust-v0.160.1` through the
supported `model_catalog_json` configuration. Codex parses and sorts the entries;
the renderer does not invent models or capabilities. The catalog includes GPT-6.1
Sol, GPT-6 Astra, GPT-6 Sol, GPT-6 Luna, GPT-5.6 Sol, GPT-5.6 Terra, GPT-5.6 Luna,
and GPT-5.5. Versioned native packages keep normal remote catalog discovery.

The bundled catalog's source, SHA256 and license are stored beside
`timewarp/shared/codex-models.json`. Update that catalog deliberately when
maintaining the vendor runtime. A catalog entry is not proof of account access;
OpenAI still authorizes requests and enforces the connected account's allowance.

Run from `timewarp` after building:

```powershell
npm run verify:model-picker
npm run verify:contracts
npm run verify:build
```

The picker verification uses the actual packaged picker and composer trigger
with isolated account and popover fixtures. It checks model selection, keyboard
navigation, model-specific effort levels, reset, credit-catalog changes,
unavailable models and retry, disabled controls, narrow layout, and both themes.
Screenshots and results are written to ignored `timewarp/reports`.
