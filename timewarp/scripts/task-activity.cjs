"use strict";
const { createTaskActivity } = require('../desktop/task-activity.cjs');
function patchTaskActivity(source) {
  const replace=(before,after)=>{if(source.split(before).length!==2)throw Error('Task activity contract changed: '+before.slice(0,90));source=source.replace(before,after);};
  replace('return h.jsxs(h.Fragment,{children:[h.jsx(own,{history:f,activity:', 'return h.jsxs(h.Fragment,{children:[i&&!g&&h.jsx(TimewarpTaskActivity,{onOpenDetails:(z,R)=>k({source:R,children:h.jsx(Pje,{threadId:z},z)})}),h.jsx(own,{history:f,activity:');
  // Keep JSON export behind the existing debug flag. Normal users can inspect
  // their own chat and workers through the authenticated trace endpoints.
  replace('children:[h.jsx(bOe,{onEditAssistant:e,onSearchConversation:n,desktopActions:', 'children:[h.jsx(ne,{type:"button",variant:"ghost",size:"sm",className:"timewarp-activity-open","aria-label":"View task activity",onClick:()=>o(!0),children:"Activity"}),h.jsx(bOe,{onEditAssistant:e,onSearchConversation:n,desktopActions:');
  replace('l&&a&&h.jsx(b.Suspense,{fallback:null,children:h.jsx(Qkn,', 'a&&h.jsx(b.Suspense,{fallback:null,children:h.jsx(Qkn,');
  return source+`\nconst TimewarpTaskActivity=(${createTaskActivity.toString()})({React:b,jsx:h,useActivity:VG});\n`;
}
module.exports = { patchTaskActivity };
