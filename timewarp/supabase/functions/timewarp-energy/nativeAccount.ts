// Reuse the production workspace and billing services with the caller's JWT.
// Personal conversations, documents and memory are never shared by switching teams.
const fail=(status:number,message:string)=>Object.assign(new Error(message),{status});
const checked=(r:any)=>{if(r.error)throw fail(503,'Account storage is temporarily unavailable.');return r.data;};
const id=(v:unknown)=>{if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(String(v)))throw fail(400,'Invalid identifier.');return String(v);};
export async function productionService(token:string,name:string,input:any){
  if(!['timewarp-workspaces','stripe-billing','composio'].includes(name))throw fail(400,'Invalid service.');
  const r=await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/${name}`,{method:'POST',headers:{authorization:`Bearer ${token}`,apikey:Deno.env.get('SUPABASE_ANON_KEY')||'','content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(30000),redirect:'error'});
  const result=await r.json().catch(()=>null);if(!r.ok)throw fail(r.status,typeof result?.error==='string'?result.error:'Account service is temporarily unavailable.');return result;
}
const role=(value:string)=>value==='lead'?'member':value;
const invitation=(v:any)=>({id:v.id,organizationId:v.workspace_id,email:v.email,role:role(v.role),status:v.status==='revoked'?'canceled':v.status,expiresAt:v.expires_at,createdAt:v.created_at});
async function preferences(admin:any,user:any){return checked(await admin.from('timewarp_energy_settings').select('settings').eq('user_id',user.id).maybeSingle())?.settings||{};}
async function patchPreferences(admin:any,user:any,patch:any){checked(await admin.rpc('timewarp_energy_patch_settings',{p_user:user.id,p_patch:patch}));}
async function saveActive(admin:any,user:any,workspaceId:string|null){await patchPreferences(admin,user,{activeWorkspaceId:workspaceId});}
export async function signedImage(admin:any,userId:string,path:unknown){
  if(!path)return null;if(typeof path!=='string'||!new RegExp(`^${userId}/[a-f0-9-]+$`,'i').test(path))throw fail(403,'This picture belongs to another account.');
  return checked(await admin.storage.from('timewarp-energy-pictures').createSignedUrl(path,3600)).signedUrl;
}
async function picture(admin:any,user:any,path:unknown){
  await signedImage(admin,user.id,path);
  const image=checked(await admin.storage.from('timewarp-energy-pictures').download(String(path)));
  if(image.size>5242880||!['image/png','image/jpeg','image/webp'].includes(image.type))throw fail(400,'Choose a PNG, JPEG or WebP picture smaller than 5 MB.');return String(path);
}
export async function nativeAccountSnapshot(admin:any,user:any,token:string){
  const listing=await productionService(token,'timewarp-workspaces',{action:'list'}),settings=await preferences(admin,user);
  const imageFor=async(path:unknown)=>typeof path==='string'?await signedImage(admin,path.split('/')[0],path).catch(()=>null):null;
  // Every account works inside a named organization; there is no personal workspace.
  // Without one, activeOrganization is null and the desktop asks the user to create one.
  const organizations=await Promise.all((listing.workspaces||[]).map(async(w:any)=>({id:w.id,name:w.name,slug:`workspace-${w.id}`,logo:await imageFor(w.settings?.timewarp_energy_picture),roles:[role(w.membership.role)],active:false})));
  const active=organizations.find((w:any)=>w.id===settings.activeWorkspaceId)||organizations[0]||null;if(active)active.active=true;
  const billing=checked(await admin.rpc('timewarp_ai_usage',{p_user_id:user.id,p_workspace_id:null}));
  return {organizations,activeOrganization:active&&{...active,billing:{plan:['pro','max','ultra'].includes(billing?.plan)?'pro':'free',status:null}},image:await signedImage(admin,user.id,user.user_metadata?.timewarp_energy_picture).catch(()=>null)};
}
export async function accountProduct(admin:any,user:any,token:string,rpc:string,input:any){
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail(400,'Invalid account input.');
  if(rpc==='product.images.beginUpload'){
    const imageId=`${user.id}/${crypto.randomUUID()}`;const upload=checked(await admin.storage.from('timewarp-energy-pictures').createSignedUploadUrl(imageId));return{imageId,uploadUrl:upload.signedUrl};
  }
  if(rpc==='product.profile.update'){
    if(input.name===undefined&&input.imageId===undefined)throw fail(400,'Choose a profile field to update.');
    const metadata={...user.user_metadata};
    if(input.name!==undefined){const name=String(input.name).trim();if(!name||name.length>100)throw fail(400,'Enter a name of at most 100 characters.');metadata.full_name=name;metadata.name=name;}
    if(input.imageId!==undefined)metadata.timewarp_energy_picture=await picture(admin,user,input.imageId);
    checked(await admin.auth.admin.updateUserById(user.id,{user_metadata:metadata}));
    if(input.name!==undefined){checked(await admin.from('profiles').update({name:metadata.full_name,updated_at:new Date().toISOString()}).eq('user_id',user.id));checked(await admin.from('timewarp_workspace_members').update({name:metadata.full_name}).eq('user_id',user.id));}return null;
  }
  if(!rpc.startsWith('product.organizations.'))return undefined;
  const snapshot=await nativeAccountSnapshot(admin,user,token),workspaceId:string|null=snapshot.activeOrganization?.id??null;
  if(rpc==='product.organizations.list')return{organizations:snapshot.organizations};
  if(rpc==='product.organizations.setActive'){
    const selected=snapshot.organizations.find((o:any)=>o.id===input.organizationId);if(!selected)throw fail(403,'You are not a member of this organization.');await saveActive(admin,user,selected.id);return null;
  }
  if(rpc==='product.organizations.create'){
    const name=String(input.name||'').trim();if(!name||name.length>120)throw fail(400,'Enter an organization name.');
    const logo=input.logo?await picture(admin,user,input.logo):null;
    const created=await productionService(token,'timewarp-workspaces',{action:'create',name}).catch((error:any)=>{throw error.status===409?fail(409,'You can be in up to 3 organizations.'):error;});
    const workspaceId=id((created.workspace||created).id);
    if(logo){const row=checked(await admin.from('timewarp_workspaces').select('settings').eq('id',workspaceId).single());checked(await admin.from('timewarp_workspaces').update({settings:{...row.settings,timewarp_energy_picture:logo},updated_at:new Date().toISOString()}).eq('id',workspaceId).select('id').single());}
    await saveActive(admin,user,workspaceId);return null;
  }
  if(rpc==='product.organizations.invitations.pending'){
    const invites=checked(await admin.from('timewarp_workspace_invites').select('*').eq('email',user.email.toLowerCase()).eq('status','pending').gt('expires_at',new Date().toISOString()))||[];
    return await Promise.all(invites.map(async(v:any)=>{const org=checked(await admin.from('timewarp_workspaces').select('id,name').eq('id',v.workspace_id).single());return{id:v.id,email:v.email,status:'pending',expiresAt:v.expires_at,organization:{...org,logo:null},inviter:{name:null,email:v.invited_by_email}};}));
  }
  if(rpc==='product.organizations.invitations.accept'){
    const invite=checked(await admin.from('timewarp_workspace_invites').select('*').eq('id',id(input.invitationId)).eq('email',user.email.toLowerCase()).eq('status','pending').gt('expires_at',new Date().toISOString()).maybeSingle());if(!invite)throw fail(404,'Invitation not found or expired.');
    // The existing acceptance service validates the workspace limit and invited email.
    // Its token is never exposed; rotate only this user's selected invitation.
    const tokenValue=crypto.randomUUID()+crypto.randomUUID();const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(tokenValue))),n=>n.toString(16).padStart(2,'0')).join('');
    checked(await admin.from('timewarp_workspace_invites').update({token_hash:digest}).eq('id',invite.id).eq('email',user.email.toLowerCase()).eq('status','pending'));
    await productionService(token,'timewarp-workspaces',{action:'acceptInvite',token:tokenValue});await saveActive(admin,user,invite.workspace_id);return null;
  }
  if(!workspaceId){
    if(rpc==='product.organizations.members'||rpc==='product.organizations.invitations.list')return[];
    throw fail(400,'Create your organization first.');
  }
  const details=await productionService(token,'timewarp-workspaces',{action:'get',workspaceId});
  if(rpc==='product.organizations.members')return(details.members||[]).map((m:any)=>({id:m.id,userId:m.user_id,email:m.email,name:m.name,image:null,roles:[role(m.role)],createdAt:m.created_at}));
  if(rpc==='product.organizations.invitations.list')return(details.invites||[]).map(invitation);
  if(!['owner','admin'].includes(details.currentMember.role))throw fail(403,'Only organization owners and admins can make this change.');
  if(rpc==='product.organizations.update'){
    const name=String(input.name||'').trim();if(!name||name.length>120)throw fail(400,'Enter an organization name.');
    const settings={...details.workspace.settings};if(input.logo!==undefined)settings.timewarp_energy_picture=input.logo?await picture(admin,user,input.logo):null;
    checked(await admin.from('timewarp_workspaces').update({name,settings,updated_at:new Date().toISOString()}).eq('id',workspaceId).select('id').single());return null;
  }
  if(rpc==='product.organizations.invitations.create'){
    if(!['admin','member'].includes(input.role)||!/^\S+@\S+\.\S+$/.test(input.email||''))throw fail(400,'Enter a valid email and role.');
    const result=await productionService(token,'timewarp-workspaces',{action:'invite',workspaceId,email:input.email,role:input.role==='member'?'lead':'admin'});
    if(!result.emailSent)throw fail(503,'The invitation was saved, but its email could not be sent. Review pending invitations in Timewarp.');return invitation(result.invite);
  }
  if(rpc==='product.organizations.invitations.revoke'){await productionService(token,'timewarp-workspaces',{action:'revokeInvite',workspaceId,inviteId:id(input.invitationId)});return null;}
  throw fail(422,'This organization action is unavailable.');
}
