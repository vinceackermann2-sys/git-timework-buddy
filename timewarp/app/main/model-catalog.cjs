"use strict";
// The models the current AI funding offers and the default model setting kept
// in line with them. Free with a connected ChatGPT / Codex account lists the
// Codex catalog; every other plan lists Timewarp's Sol and Luna. A catalog that
// can't be read is an error, as in the previous app: the saved choice is kept
// and never replaced from a fallback list.
const { resolveModelSettings } = require("../../shared/model-capabilities.cjs");

const fail = (status, message) => Object.assign(new Error(message), { status });

function createModelCatalog({ ready = () => undefined, funding, chatgpt, settings, userId, timewarpModels = () => require("../../shared/models.cjs").models(), log = () => {} }) {
  async function modelChoices() {
    await ready();
    if (userId() && (await funding.current()).source === "chatgpt") {
      try { return await chatgpt.models(); }
      catch (error) { log("ChatGPT models unavailable: " + error.message); throw error; }
    }
    return timewarpModels();
  }

  // A model the catalog no longer offers, or an effort or speed it doesn't
  // support, becomes the catalog's default. Without a catalog nothing changes.
  async function selectModel(choices) {
    choices = choices || await modelChoices();
    if (!choices.length) return settings.get("modelSettings") || null;
    const current = settings.get("modelSettings") || {};
    const selected = resolveModelSettings(choices, current);
    if (selected && Object.keys(selected).some(key => selected[key] !== current[key])) settings.set("modelSettings", selected);
    return selected;
  }

  return { modelChoices, selectModel };
}

// A choice from the picker: the model must be in the catalog; an effort or
// speed it doesn't offer becomes the model's default.
function chooseModel(choices, { name, reasoningEffort, serviceTier } = {}) {
  if (typeof name !== "string" || !choices.some(item => item.id === name)) throw fail(400, "This model is not available on your plan.");
  return resolveModelSettings(choices, { name, reasoningEffort, serviceTier });
}

module.exports = { createModelCatalog, chooseModel };
