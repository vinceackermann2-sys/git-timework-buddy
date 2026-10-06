"use strict";
function models(){return ['sol','luna'].map(name=>({id:'openai/gpt-5.6-'+name,displayName:name==='sol'?'Sol':'Luna',description:'Timewarp cloud model',inputModalities:['text','image'],supportedReasoningEfforts:[{reasoningEffort:'low',description:'Fast'},{reasoningEffort:'medium',description:'Balanced'},{reasoningEffort:'high',description:'Detailed'}],defaultReasoningEffort:'low',featured:true,serviceTiers:[{value:null,label:'Standard',description:'Uses your Timewarp credits'}],defaultServiceTier:null}));}
module.exports={models};
