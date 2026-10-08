"use strict";

// Keep provider ids intact: display names are not request service-tier values.
function codexModel(item) {
  const efforts = [...new Map((item.supportedReasoningEfforts || []).filter(option => typeof option.reasoningEffort === 'string' && option.reasoningEffort).map(option => [option.reasoningEffort, { reasoningEffort: option.reasoningEffort, description: option.description || '' }])).values()];
  if (!efforts.length && item.defaultReasoningEffort) efforts.push({ reasoningEffort: item.defaultReasoningEffort, description: 'Default' });
  if (!efforts.length) return null;
  const serviceTiers = [{ value: null, label: 'Standard', description: 'Uses your ChatGPT / Codex allowance' }];
  for (const tier of item.serviceTiers || []) {
    if (typeof tier.id === 'string' && tier.id && tier.id !== 'default' && !serviceTiers.some(option => option.value === tier.id)) serviceTiers.push({ value: tier.id, label: tier.name || tier.id, description: tier.description || '' });
  }
  return { id: item.model || item.id, displayName: item.displayName || item.model || item.id, description: item.description || 'Uses your Codex allowance', inputModalities: item.inputModalities || ['text', 'image'], supportedReasoningEfforts: efforts, defaultReasoningEffort: efforts.some(option => option.reasoningEffort === item.defaultReasoningEffort) ? item.defaultReasoningEffort : efforts[0].reasoningEffort, featured: item.isDefault === true, serviceTiers, defaultServiceTier: serviceTiers.some(tier => tier.value === item.defaultServiceTier) ? item.defaultServiceTier : null };
}

function resolveModelSettings(choices, settings = {}) {
  const exact = choices.find(model => model.id === settings.name) || choices.find(model => model.id === settings.name?.replace(/^openai\//, ''));
  const model = exact || choices.find(model => model.featured) || choices[0];
  if (!model) return null;
  return { name: model.id, reasoningEffort: exact && model.supportedReasoningEfforts.some(option => option.reasoningEffort === settings.reasoningEffort) ? settings.reasoningEffort : model.defaultReasoningEffort, serviceTier: exact && model.serviceTiers.some(tier => tier.value === settings.serviceTier) ? settings.serviceTier : model.defaultServiceTier ?? null };
}
module.exports = { codexModel, resolveModelSettings };
