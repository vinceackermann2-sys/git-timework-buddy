"use strict";
// Every account works inside a cloud organization (there is no personal
// workspace). Chats and AI credits stay personal, so organization pages show
// no balance. Organizations without an uploaded photo use the standard picture.

function replaceOnce(source, before, after, name) {
  if (source.split(before).length !== 2) throw new Error("Organization contract changed: " + name);
  return source.replace(before, after);
}

const standardPicture = (className, label) =>
  'h.jsx("span",{role:"img","aria-label":' + label + ',className:te("timewarp-org-default rounded-lg",' + className + '),children:h.jsx("img",{src:"./timewarp-logo.svg",alt:""})})';

function patchOrganizations(source) {
  source = replaceOnce(source,
    'Ag=({className:t,organization:e})=>e.logo?h.jsxs(_2,{className:te("rounded-lg bg-muted",t),children:[h.jsx(S2,{src:e.logo,alt:`${e.name} organization picture`}),h.jsx(vo,{className:"rounded-lg p-0",children:h.jsx(Xee,{className:"size-full rounded-none",label:`${e.name} organization image`,seed:e.id})})]}):h.jsx(Xee,{className:te("rounded-lg",t),label:`${e.name} organization image`,seed:e.id})',
    'Ag=({className:t,organization:e})=>e.logo?h.jsxs(_2,{className:te("rounded-lg bg-muted",t),children:[h.jsx(S2,{src:e.logo,alt:`${e.name} organization picture`}),h.jsx(vo,{className:"rounded-lg p-0",children:' + standardPicture('"size-full"', '`${e.name} organization picture`') + '})]}):' + standardPicture('t', '`${e.name} organization picture`'),
    "standard organization picture");
  // The account button names the active organization, so it shows its picture.
  source = replaceOnce(source,
    's?h.jsx(But,{organization:s,user:e.user}):h.jsx(bW,{className:"size-6",user:e.user})',
    's?h.jsx(Ag,{organization:s,className:"size-7 shrink-0"}):h.jsx(bW,{className:"size-6",user:e.user})',
    "organization picture on the account button");
  source = replaceOnce(source, 'h.jsx(Edn,{}),', '', "organization page credit balance");
  // Billing is personal, so team members (not just admins) keep it in Settings.
  source = replaceOnce(source, '(s.id!=="billing"||zdn(t))', '(s.id!=="billing"||!!t)', "personal billing in every organization");
  source = replaceOnce(source,
    'Add a separate workspace with its own members, billing, and usage.',
    'Add another organization you can invite people to. Chats and AI credits stay personal.',
    "create organization description");
  return replaceOnce(source,
    '. Joining gives you access to its members and shared credits.',
    '. Joining adds you to its members. Your chats and AI credits stay personal.',
    "invitation description");
}

module.exports = { patchOrganizations };
