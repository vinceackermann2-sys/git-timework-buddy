"use strict";
// Rebrands onboarding prompt text fetched by the inherited desktop interface
// (old pipeline only).
function brandPromptBundle(bundle){
  const prompts=Object.fromEntries(Object.entries(bundle.prompts).map(([name,text])=>[name,text.replace(/\bEnergy\b/g,'Timewarp').replace('If you already have a ChatGPT plan, connect it to use Timewarp for free!','On the Free plan, you can connect an eligible ChatGPT or Codex subscription to power Timewarp. You can also use Timewarp credits.')]));
  return {...bundle,prompts};
}
module.exports={brandPromptBundle};
