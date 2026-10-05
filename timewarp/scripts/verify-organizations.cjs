"use strict";
// Live organization acceptance with two disposable @example.invalid accounts.
// Exercises the same cloud RPCs the desktop uses, then removes every fixture.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {request,keys,fixture,token,root}=require('./live-client.cjs');
const base='/functions/v1/timewarp-energy';
const report={verifiedAt:new Date().toISOString(),passed:false,checks:{}};
const pass=(name,value)=>{assert.ok(value,name);report.checks[name]=true;};
const rpc=(t,name,input={})=>request(base+'/native/rpc',{rpc:name,input},t);
async function ok(r,name){if(r.status!==200)throw Error(name+' failed with '+r.status+': '+JSON.stringify(r.data?.error||r.data));report.checks[name]=true;return r.data;}
let owner,member,adminToken;const workspaces=new Set(),pictures=[];
async function run(){
  adminToken=keys();owner=await fixture({save:false});member=await fixture({save:false});
  const ownerToken=await token(owner),memberToken=await token(member);
  const fresh=await ok(await request(base+'/account',{},ownerToken),'newAccountRead');
  pass('newAccountHasNoPersonalWorkspace',fresh.activeOrganization===null&&fresh.organizations.length===0);
  pass('cannotInviteWithoutOrganization',(await rpc(ownerToken,'product.organizations.invitations.create',{email:member.email,role:'member'})).status===400);
  pass('personalSelectionRejected',(await rpc(ownerToken,'product.organizations.setActive',{organizationId:'personal_'+owner.id})).status===403);
  // A 1×1 PNG stands in for an uploaded organization photo.
  const upload=await ok(await rpc(ownerToken,'product.images.beginUpload'),'pictureUploadUrl');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
  pass('pictureUploaded',(await fetch(upload.uploadUrl,{method:'PUT',headers:{'content-type':'image/png'},body:png})).ok);
  await ok(await rpc(ownerToken,'product.organizations.create',{name:'Organization acceptance',logo:upload.imageId}),'organizationCreate');
  pictures.push(upload.imageId);
  const account=await ok(await request(base+'/account',{},ownerToken),'organizationRead');const workspaceId=account.activeOrganization.id;workspaces.add(workspaceId);
  pass('createdTeamBecomesActive',!workspaceId.startsWith('personal_')&&account.activeOrganization.name==='Organization acceptance'&&account.activeOrganization.roles.includes('owner'));
  pass('createdWithUploadedPicture',typeof account.activeOrganization.logo==='string'&&account.activeOrganization.logo.startsWith('http'));
  pass('switcherListsOnlyOrganizations',(await ok(await rpc(ownerToken,'product.organizations.list'),'organizationList')).organizations.every(o=>!o.id.startsWith('personal_')));
  const invite=await ok(await rpc(ownerToken,'product.organizations.invitations.create',{email:member.email,role:'member'}),'inviteMember');
  pass('inviteIsPendingMember',invite.status==='pending'&&invite.role==='member'&&invite.email===member.email);
  pass('duplicateInviteRejected',(await rpc(ownerToken,'product.organizations.invitations.create',{email:member.email,role:'member'})).status===409);
  pass('ownerSeesInvite',(await ok(await rpc(ownerToken,'product.organizations.invitations.list'),'inviteList')).some(i=>i.id===invite.id));
  const pending=await ok(await rpc(memberToken,'product.organizations.invitations.pending'),'pendingInvitations');
  pass('invitedPersonSeesInvite',pending.some(i=>i.id===invite.id&&i.organization.name==='Organization acceptance'));
  pass('ownerCannotAcceptOthersInvite',(await rpc(ownerToken,'product.organizations.invitations.accept',{invitationId:invite.id})).status===404);
  await ok(await rpc(memberToken,'product.organizations.invitations.accept',{invitationId:invite.id}),'acceptInvitation');
  const joined=await ok(await request(base+'/account',{},memberToken),'memberAccount');
  pass('acceptedTeamBecomesActive',joined.activeOrganization.id===workspaceId&&joined.activeOrganization.roles.includes('member'));
  const members=await ok(await rpc(ownerToken,'product.organizations.members'),'memberList');
  pass('bothMembersListed',members.length===2&&members.some(m=>m.email===member.email&&m.roles.includes('member')));
  pass('memberCannotInvite',(await rpc(memberToken,'product.organizations.invitations.create',{email:'someone@example.invalid',role:'member'})).status===403);
  pass('invitationReplayRejected',(await rpc(memberToken,'product.organizations.invitations.accept',{invitationId:invite.id})).status===404);
  const second=await ok(await rpc(ownerToken,'product.organizations.invitations.create',{email:'revoked-'+Date.now()+'@example.invalid',role:'admin'}),'inviteAdmin');
  await ok(await rpc(ownerToken,'product.organizations.invitations.revoke',{invitationId:second.id}),'revokeInvitation');
  pass('revokedInviteRemoved',!(await ok(await rpc(ownerToken,'product.organizations.invitations.list'),'inviteListAfterRevoke')).some(i=>i.id===second.id&&i.status==='pending'));
  await ok(await rpc(ownerToken,'product.organizations.create',{name:'Second organization'}),'secondOrganizationCreate');
  const second2=await ok(await request(base+'/account',{},ownerToken),'secondOrganizationRead');workspaces.add(second2.activeOrganization.id);
  pass('secondOrganizationUsesStandardPicture',second2.activeOrganization.logo===null&&second2.organizations.length===2);
  await ok(await rpc(ownerToken,'product.organizations.setActive',{organizationId:workspaceId}),'switchOrganization');
  pass('switchBetweenOrganizations',(await ok(await request(base+'/account',{},ownerToken),'switchedRead')).activeOrganization.id===workspaceId);
  report.passed=true;
}
run().catch(error=>{report.error=error.message;process.exitCode=1;}).finally(async()=>{
  const cleanup={accounts:[]};
  try{
    if(pictures.length)cleanup.pictures=(await request('/storage/v1/object/timewarp-energy-pictures',{prefixes:pictures},adminToken,'DELETE')).status;
    for(const id of workspaces){
      await request('/rest/v1/timewarp_workspace_invites?workspace_id=eq.'+id,undefined,adminToken,'DELETE');
      await request('/rest/v1/timewarp_workspace_members?workspace_id=eq.'+id,undefined,adminToken,'DELETE');
      cleanup['organization '+id]=(await request('/rest/v1/timewarp_workspaces?id=eq.'+id,undefined,adminToken,'DELETE')).status;
    }
    for(const user of [owner,member].filter(Boolean)){
      await request('/rest/v1/timewarp_energy_settings?user_id=eq.'+user.id,undefined,adminToken,'DELETE');
      cleanup.accounts.push((await request('/auth/v1/admin/users/'+user.id,undefined,adminToken,'DELETE')).status);
    }
  }catch(error){cleanup.error=error.message;process.exitCode=1;}
  report.cleanup=cleanup;
  fs.writeFileSync(path.join(root,'reports/organizations-cloud.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
});
