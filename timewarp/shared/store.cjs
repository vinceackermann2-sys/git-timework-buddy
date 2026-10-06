"use strict";
const fields = ['storeId','identityName','publisher','publisherDisplayName','packageFamilyName','applicationId','displayName','version','previousPackageVersion','minimumWindowsVersion'];
function versionParts(value, count) {
  if (typeof value !== 'string' || !new RegExp('^(0|[1-9]\\d*)(\\.(0|[1-9]\\d*)){'+(count-1)+'}$').test(value)) throw new Error('Invalid Store package version.');
  const parts = value.split('.').map(Number);
  if (parts.some(part => part > 65535)) throw new Error('Store version components must be at most 65535.');
  return parts;
}
function validateStore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some(key => typeof value[key] !== 'string') || Object.keys(value).some(key => !fields.includes(key))) throw new Error('Store identity configuration is incomplete.');
  for (const text of Object.values(value)) if (!text.trim() || /[\r\n\0<>"'&]/.test(text)) throw new Error('Invalid Store identity field.');
  if (!/^9[A-Z0-9]{11}$/.test(value.storeId) || !/^[A-Za-z][A-Za-z0-9.-]{2,49}$/.test(value.identityName) || !/^CN=[A-F0-9-]{36}$/.test(value.publisher)) throw new Error('Copy the existing package identity from Partner Center.');
  if (!value.packageFamilyName.startsWith(value.identityName+'_') || !/_[a-z0-9]{13}$/.test(value.packageFamilyName)) throw new Error('Invalid Store package family.');
  if (value.applicationId.length > 64 || !/^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$/.test(value.applicationId)) throw new Error('Invalid Store application ID.');
  const next = [...versionParts(value.version,3),0], previous = versionParts(value.previousPackageVersion,4);
  let newer = false;
  for (let index=0;index<4;index++) { if(next[index]===previous[index]) continue; newer=next[index]>previous[index]; break; }
  if (!newer) throw new Error('A Store update must be newer than the existing package.');
  versionParts(value.minimumWindowsVersion,4);
  return {...value, packageVersion:next.join('.'), appUserModelId:value.packageFamilyName+'!'+value.applicationId};
}
module.exports={validateStore};
