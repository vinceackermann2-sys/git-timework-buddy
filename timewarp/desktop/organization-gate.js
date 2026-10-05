"use strict";
// Every signed-in account works inside an organization. Without one, this
// screen covers the app until the user names (and optionally pictures) a new
// organization, or joins one they were invited to.
(() => {
  const request=(action,input={})=>window.timewarp.request(action,input).catch(error=>{throw new Error(error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));});
  const el=(tag,text,classes)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(classes)node.className=classes;return node;};
  let shown=false,confirmed=false,checking=null;
  async function check(){
    if(shown||confirmed||checking)return;
    checking=(async()=>{
      const state=await request('state');if(!state.user)return;
      const status=await request('organizationStatus');
      if(status.active)confirmed=true;else show(status.invitations||[]);
    })().catch(()=>{}).finally(()=>{checking=null;});
  }
  function show(invitations){
    shown=true;
    const overlay=el('div',null,'timewarp-org-gate');overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby','timewarp-org-gate-title');
    const shell=el('div',null,'timewarp-org-gate-shell');overlay.append(shell);
    const card=el('section',null,'timewarp-org-gate-card');shell.append(card);
    const title=el('h1','Create your organization');title.id='timewarp-org-gate-title';
    card.append(title,el('p','Timewarp works inside an organization. Name yours and add a picture. You can invite your team afterwards.','timewarp-org-gate-lead'));
    const form=el('form');card.append(form);
    let file=null,preview=null,busy=false;
    const pictureRow=el('div',null,'timewarp-org-gate-picture');
    const frame=el('span',null,'timewarp-org-gate-frame');
    const picker=el('input');picker.type='file';picker.accept='image/png,image/jpeg,image/webp';picker.hidden=true;
    const upload=el('button','Upload photo','timewarp-org-gate-secondary');upload.type='button';upload.onclick=()=>picker.click();
    const reset=el('button','Use standard picture','timewarp-org-gate-link');reset.type='button';reset.onclick=()=>{file=null;paint();};
    const pictureText=el('div',null,'timewarp-org-gate-picture-actions');pictureText.append(upload,reset);
    pictureRow.append(frame,pictureText,picker);
    const paint=()=>{
      if(preview)URL.revokeObjectURL(preview);preview=file?URL.createObjectURL(file):null;
      frame.replaceChildren();const image=el('img');
      if(preview){frame.className='timewarp-org-gate-frame';image.src=preview;image.alt='Organization picture';}
      else{frame.className='timewarp-org-gate-frame timewarp-org-default';image.src='./timewarp-logo.svg';image.alt='Standard organization picture';}
      frame.append(image);reset.hidden=!file;
    };
    picker.onchange=()=>{const chosen=picker.files?.[0];picker.value='';if(!chosen)return;
      if(chosen.size>5242880||!['image/png','image/jpeg','image/webp'].includes(chosen.type)){error.textContent='Choose a PNG, JPEG or WebP picture smaller than 5 MB.';return;}
      error.textContent='';file=chosen;paint();};
    const label=el('label','Organization name');const name=el('input');name.required=true;name.maxLength=120;name.placeholder='Acme Research';name.autocomplete='organization';label.append(name);
    const error=el('p',null,'timewarp-org-gate-error');error.setAttribute('role','alert');
    const submit=el('button','Create organization','timewarp-org-gate-primary');submit.type='submit';
    form.append(pictureRow,label,error,submit);paint();
    const setBusy=value=>{busy=value;for(const control of overlay.querySelectorAll('button,input'))control.disabled=value;};
    const finish=()=>{location.hash='#/customize/organization';location.reload();};
    form.onsubmit=async event=>{
      event.preventDefault();if(busy)return;const value=name.value.trim();if(!value){name.focus();return;}
      setBusy(true);error.textContent='';
      try{
        let imageId;
        if(file){const target=await request('organizationPictureUpload');const sent=await fetch(target.uploadUrl,{method:'PUT',headers:{'content-type':file.type},body:file});if(!sent.ok)throw new Error('The picture could not be uploaded. Try again or use the standard picture.');imageId=target.imageId;}
        await request('createOrganization',{name:value,imageId});finish();
      }catch(failure){error.textContent=failure.message||'Could not create the organization.';setBusy(false);}
    };
    if(invitations.length){
      const join=el('section',null,'timewarp-org-gate-invites');join.append(el('h2','Or join an organization you were invited to'));
      for(const invite of invitations){
        const row=el('div',null,'timewarp-org-gate-invite');const text=el('div');
        text.append(el('strong',invite.organization?.name||'Organization'),el('span','Invited by '+(invite.inviter?.name||invite.inviter?.email||'a teammate')));
        const accept=el('button','Join','timewarp-org-gate-secondary');accept.type='button';
        accept.onclick=async()=>{if(busy)return;setBusy(true);error.textContent='';try{await request('joinOrganization',{invitationId:invite.id});finish();}catch(failure){error.textContent=failure.message||'Could not join the organization.';setBusy(false);}};
        row.append(text,accept);join.append(row);
      }
      card.append(join);
    }
    const signOut=el('button','Sign out','timewarp-org-gate-link');signOut.type='button';signOut.onclick=async()=>{setBusy(true);try{await request('signOut');}finally{location.reload();}};
    card.append(signOut);
    document.body.append(overlay);name.focus();
  }
  const start=()=>{void check();window.addEventListener('hashchange',()=>void check());window.addEventListener('focus',()=>void check());};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
