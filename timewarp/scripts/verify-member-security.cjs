"use strict";
// Disposable fixtures only. No invitation emails are dispatched.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {request,keys,fixture,token,root}=require('./live-client.cjs');
const report={verifiedAt:new Date().toISOString(),passed:false,checks:{},findings:[]};
const users=[],orgs=[];let service;
const ok=(r,label)=>{assert.ok(r.status>=200&&r.status<300,label+': '+r.status);return r.data;};
const rpc=(t,name,input={})=>request('/functions/v1/timewarp-energy/native/rpc',{rpc:name,input},t);
(async()=>{
  service=keys();for(let i=0;i<3;i++)users.push(await fixture({save:false}));
  const [owner,admin,outsider]=users,[ot,at,xt]=await Promise.all(users.map(token));
  ok(await rpc(ot,'product.organizations.create',{name:'Membership security audit '+crypto.randomUUID()}),'create');
  const initial=ok(await request('/functions/v1/timewarp-energy/account',{},ot),'snapshot');
  const wid=initial.activeOrganization.id;orgs.push(wid);
  const aid=crypto.randomUUID();
  ok(await request('/rest/v1/timewarp_workspace_members',{id:aid,workspace_id:wid,user_id:admin.id,email:admin.email,name:'Audit admin',role:'admin',status:'active'},service),'seed admin');
  report.checks.outsiderCannotSelectOrganization=(await rpc(xt,'product.organizations.setActive',{organizationId:wid})).status===403;
  report.checks.outsiderCannotReadMembers=ok(await request('/rest/v1/timewarp_workspace_members?workspace_id=eq.'+wid,undefined,xt,'GET'),'outsider members').length===0;
  report.checks.outsiderCannotReadInvites=ok(await request('/rest/v1/timewarp_workspace_invites?workspace_id=eq.'+wid,undefined,xt,'GET'),'outsider invites').length===0;
  report.checks.adminCannotPromoteThroughService=(await request('/functions/v1/timewarp-workspaces',{action:'updateMemberRole',workspaceId:wid,memberId:aid,role:'owner'},at)).status===403;
  const bypass=await request('/rest/v1/timewarp_workspace_members?id=eq.'+aid,{role:'owner'},at,'PATCH');
  const rows=ok(await request('/rest/v1/timewarp_workspace_members?id=eq.'+aid,undefined,service,'GET'),'read admin role');
  report.checks.adminCannotPromoteThroughDatabase=rows[0].role==='admin';
  if(rows[0].role==='owner')report.findings.push('Admin self-promoted to owner through authenticated REST PATCH (status '+bypass.status+').');
  ok(await request('/rest/v1/timewarp_workspace_members?id=eq.'+aid,{role:'admin'},service,'PATCH'),'reset fixture role');
  const current=ok(await request('/rest/v1/timewarp_workspace_members?workspace_id=eq.'+wid+'&user_id=eq.'+owner.id,undefined,service,'GET'),'owner membership')[0];
  report.checks.serviceProtectsLastOwner=(await request('/functions/v1/timewarp-workspaces',{action:'removeMember',workspaceId:wid,memberId:current.id},ot)).status===409;
  const demote=await request('/rest/v1/timewarp_workspace_members?id=eq.'+current.id,{role:'lead'},at,'PATCH');
  const after=ok(await request('/rest/v1/timewarp_workspace_members?id=eq.'+current.id,undefined,service,'GET'),'read owner role')[0];
  report.checks.adminCannotDemoteLastOwnerThroughDatabase=after.role==='owner';
  if(after.role!=='owner')report.findings.push('Admin demoted the last owner through authenticated REST PATCH (status '+demote.status+').');
  ok(await request('/rest/v1/timewarp_workspace_members?id=eq.'+current.id,{role:'owner'},service,'PATCH'),'reset owner');
  const invId=crypto.randomUUID();
  ok(await request('/rest/v1/timewarp_workspace_invites',{id:invId,workspace_id:wid,email:outsider.email,role:'lead',token_hash:crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex'),invited_by:owner.id,invited_by_email:owner.email},service),'seed invite');
  report.checks.wrongUserCannotAccept=(await rpc(ot,'product.organizations.invitations.accept',{invitationId:invId})).status===404;
  const accepted=await rpc(xt,'product.organizations.invitations.accept',{invitationId:invId});
  report.checks.correctRecipientCanAccept=accepted.status===200;
  report.checks.inviteReplayRejected=(await rpc(xt,'product.organizations.invitations.accept',{invitationId:invId})).status===404;
  report.checks.joinBecomesActive=ok(await request('/functions/v1/timewarp-energy/account',{},xt),'joined snapshot').activeOrganization.id===wid;
  report.passed=Object.values(report.checks).every(Boolean);
  if(!report.passed)process.exitCode=1;
})().catch(error=>{report.error=error.message;process.exitCode=1;}).finally(async()=>{
  report.cleanup={};
  // Recover a fixture organization even if its account snapshot failed after
  // creation. The filter is restricted to these newly created fixture owners.
  if(service)for(const user of users){
    const found=await request('/rest/v1/timewarp_workspaces?select=id&created_by=eq.'+user.id,undefined,service,'GET');
    if(found.status===200)for(const row of found.data||[])if(!orgs.includes(row.id))orgs.push(row.id);
  }
  report.cleanup.organizations=[];
  for(const wid of orgs)report.cleanup.organizations.push((await request('/rest/v1/timewarp_workspaces?id=eq.'+wid,undefined,service,'DELETE')).status);
  report.cleanup.accounts=[];
  for(const user of users)report.cleanup.accounts.push((await request('/auth/v1/admin/users/'+user.id,undefined,service,'DELETE')).status);
  if(!report.cleanup.organizations.every(status=>status===204)||!report.cleanup.accounts.every(status=>status===200)){
    report.passed=false;report.cleanup.error='Fixture cleanup failed.';process.exitCode=1;
  }
  fs.writeFileSync(path.join(root,'reports/member-security-live.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
});
