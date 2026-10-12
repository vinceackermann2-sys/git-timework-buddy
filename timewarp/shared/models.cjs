"use strict";
// Timewarp's cloud models, most intelligent first (SCORES): Claude and OpenAI's
// GPT-6 models on Azure, with GPT-6.1 Sol as the default. Every plan lists them
// all; on Free they run on purchased Timewarp credits (Free with a connected
// ChatGPT / Codex account lists Codex's own models instead, model-catalog.cjs).

// Each model's intelligence, speed and low cost from 0 to 1, against the best
// of all Timewarp's models, from Artificial Analysis's benchmarks
// (model-benchmarks.json):
// - Intelligence: the average share of the best score across every evaluation;
//   on the two Elo ratings, twice the expected score against the best model.
//   Models without evaluation scores are placed by their Intelligence Index,
//   along the line the other models' indexes and averages follow.
// - Speed: the average of output speed, time to first token and time per task
//   (the tokens a model writes over its output speed, so a fast but wordy model
//   isn't counted as quick), each as a share of the best.
// - Low cost: the average of the blended price per million tokens (7:2:1 cache
//   hits, input, output) and the cost per task, each on a log scale from the
//   cheapest (1) to the priciest (0.1), as prices span 100x.
const BENCHMARKS = require("./model-benchmarks.json").models;
const ELO = new Set(["briefcaseElo", "gdpvalElo"]);
const ids = Object.keys(BENCHMARKS);
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const best = (pick, pickBest = Math.max) => pickBest(...ids.map(pick).filter(value => value !== undefined));
function evaluationShare(id) {
  const scores = BENCHMARKS[id].evaluations;
  if (!scores) return undefined;
  return average(Object.entries(scores).map(([name, score]) => {
    const top = best(other => BENCHMARKS[other].evaluations?.[name]);
    return ELO.has(name) ? 2 / (1 + 10 ** ((top - score) / 400)) : Math.max(0, score) / top;
  }));
}
const evaluated = ids.filter(id => BENCHMARKS[id].evaluations);
const indexLine = (() => {
  const xs = evaluated.map(id => BENCHMARKS[id].intelligenceIndex), ys = evaluated.map(evaluationShare), mx = average(xs), my = average(ys);
  const slope = xs.reduce((sum, x, at) => sum + (x - mx) * (ys[at] - my), 0) / xs.reduce((sum, x) => sum + (x - mx) ** 2, 0);
  return index => Math.min(1, Math.max(0, my + slope * (index - mx)));
})();
const timePerTask = id => BENCHMARKS[id].outputTokensMillions / BENCHMARKS[id].tokensPerSecond;
const blendedPrice = id => { const price = BENCHMARKS[id].pricePerMillion; return (7 * price.cacheHit + 2 * price.input + price.output) / 10; };
const lowCost = pick => id => { const low = best(pick, Math.min), high = best(pick); return 1 - 0.9 * Math.log(pick(id) / low) / Math.log(high / low); };
const SCORES = Object.fromEntries(ids.map(id => [id, {
  intelligence: evaluationShare(id) ?? indexLine(BENCHMARKS[id].intelligenceIndex),
  speed: average([BENCHMARKS[id].tokensPerSecond / best(other => BENCHMARKS[other].tokensPerSecond), best(other => BENCHMARKS[other].timeToFirstToken, Math.min) / BENCHMARKS[id].timeToFirstToken, best(timePerTask, Math.min) / timePerTask(id)]),
  cost: average([lowCost(blendedPrice)(id), lowCost(other => BENCHMARKS[other].costPerTask)(id)]),
}]));
// Ties go to the faster model.
const byIntelligence = list => list.sort((a, b) => SCORES[b.id].intelligence - SCORES[a.id].intelligence || SCORES[b.id].speed - SCORES[a.id].speed);
// What the picker shows on each model: each score as a percentage, 100% being
// the best of Timewarp's models on it.
const percent = key => { const top = Math.max(...ids.map(id => SCORES[id][key])); return id => Math.round(100 * SCORES[id][key] / top); };
const [intelligencePercent, speedPercent, costPercent] = ["intelligence", "speed", "cost"].map(percent);
const withStats = list => list.map(item => ({ ...item, stats: { intelligence: intelligencePercent(item.id), speed: speedPercent(item.id), cost: costPercent(item.id) } }));
const effort = (reasoningEffort, description) => ({ reasoningEffort, description });
// Claude models think adaptively; effort sets how much (Anthropic's levels).
const CLAUDE_EFFORTS = [effort("low", "Fastest, light thinking"), effort("medium", "Balanced"), effort("high", "Deeper thinking"), effort("xhigh", "Extra deep, for long coding and agent work"), effort("max", "Deepest thinking, uses the most credits")];
// GPT's levels as Codex's catalog lists them, without Codex's own Ultra mode.
const GPT_EFFORTS = [effort("low", "Fast"), effort("medium", "Balanced"), effort("high", "Detailed"), effort("xhigh", "Extra detailed"), effort("max", "Maximum depth, uses the most credits")];
const STANDARD = { value: null, label: "Standard", description: "Uses your Timewarp credits" };
// Codex names a model's Fast tier "priority": Anthropic's Fast mode for Claude,
// Azure's priority processing for GPT-6.
const fast = speed => ({ value: "priority", label: "Fast", description: `Up to ${speed} faster replies, uses twice the credits` });
const model = (id, displayName, description, supportedReasoningEfforts, defaultReasoningEffort, { featured = false, speed = null } = {}) => ({
  id, displayName, description, inputModalities: ["text", "image"], supportedReasoningEfforts, defaultReasoningEffort, featured,
  serviceTiers: speed ? [STANDARD, fast(speed)] : [STANDARD], defaultServiceTier: null,
});
const MODELS = withStats(byIntelligence([
  model("anthropic/claude-opus-5-5", "Claude Opus 5.5", "Anthropic's frontier model for complex agent and coding work", CLAUDE_EFFORTS, "medium", { speed: "2.5x" }),
  model("anthropic/claude-sonnet-5-5", "Claude Sonnet 5.5", "Fast and capable for everyday work", CLAUDE_EFFORTS, "high"),
  model("anthropic/claude-fable-5-1", "Claude Fable 5.1", "Anthropic's model for the hardest long-running work", CLAUDE_EFFORTS, "high"),
  model("openai/gpt-6-astra", "GPT-6 Astra", "OpenAI's frontier model for the most demanding work", GPT_EFFORTS, "low", { speed: "2x" }),
  model("openai/gpt-6.1-sol", "GPT-6.1 Sol", "OpenAI's workhorse model for coding and everyday work", GPT_EFFORTS, "low", { featured: true, speed: "2x" }),
  model("anthropic/claude-haiku-5-5", "Claude Haiku 5.5", "Anthropic's fastest, most affordable model", CLAUDE_EFFORTS, "medium"),
  model("openai/gpt-6-luna", "GPT-6 Luna", "OpenAI's fast, affordable model for easier tasks", GPT_EFFORTS, "medium", { speed: "1.5x" }),
]));

function models() {
  return MODELS.map(item => ({ ...item, supportedReasoningEfforts: item.supportedReasoningEfforts.map(option => ({ ...option })), serviceTiers: item.serviceTiers.map(tier => ({ ...tier })), stats: { ...item.stats } }));
}

// The model name Codex sends to the cloud. Codex forwards a speed only for its
// own models, so Claude's Fast mode travels in the name (cloud/claudeAgentAi.ts);
// GPT-6's goes as Codex's service_tier.
function codexModelName({ name, serviceTier } = {}) {
  return /^anthropic\//.test(name || "") && serviceTier === "priority" ? name + "-fast" : name;
}

module.exports = { models, codexModelName, SCORES };
