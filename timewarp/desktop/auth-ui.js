"use strict";
(() => {
  const request=(action,input={})=>window.timewarp.request(action,input).catch(error=>{throw new Error(error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));});
  const el=(tag,text,classes)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(classes)node.className=classes;return node;};
  const button=(label,action,primary=false)=>{const node=el('button',label,primary?'rounded-md bg-primary px-4 py-3 text-primary-foreground font-medium':'rounded-md border bg-background px-4 py-2 text-sm text-foreground');node.type='button';node.onclick=action;return node;};
  const field=(form,label,type,required=true)=>{const wrap=el('label',label,'grid gap-2 text-left text-sm'),input=el('input',null,'rounded-md border bg-background px-3 py-3 text-foreground');input.type=type;input.required=required;wrap.append(input);form.append(wrap);return input;};
  const googleMark=()=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');for(const [fill,d]of [['#4285F4','M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.28-4.74 3.28-8.09z'],['#34A853','M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z'],['#FBBC05','M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z'],['#EA4335','M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z']]){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('fill',fill);path.setAttribute('d',d);svg.append(path);}return svg;};
  function mount(container,{dialog=false}={}){
    if(container.dataset.timewarpAuthMounted)return;container.dataset.timewarpAuthMounted='true';
    let mode='signIn',confirmationPurpose='signup',address='',busy=false,providers={google:false,signup:true},resendAt=0,updateProviders=()=>{};
    const shell=el('div',null,'timewarp-auth-shell relative flex w-full max-w-md flex-col items-center text-center');
    const brand=el('div',null,'timewarp-auth-brand'),image=el('img');image.src='./timewarp-logo.svg';image.alt='';brand.append(image,el('span','Timewarp'));shell.append(brand);
    const card=el('section',null,'timewarp-auth-card');shell.append(card);container.append(shell);
    function render(notice=''){
      card.replaceChildren();const titles={signIn:'Welcome to Timewarp',signUp:'Create your Timewarp account',email:'Sign in with email',confirm:'Check your email',recovery:'Reset your password',newPassword:'Choose a new password'};
      card.append(el('h1',titles[mode],'text-3xl text-balance'));
      const status=el('p',notice||({signIn:'Sign in to continue',signUp:'Create an account to save your work',email:'We’ll send a secure sign-in link',confirm:'Open the email link on this computer, or enter the code if your email includes one.',recovery:'We’ll send a password reset link',newPassword:'Use at least 8 characters.'})[mode],'my-5 text-sm text-muted-foreground');status.setAttribute('role','status');status.setAttribute('aria-live','polite');card.append(status);
      let googleGroup,signup;
      if(['signIn','signUp'].includes(mode)){
        googleGroup=el('div',null,'timewarp-auth-providers');googleGroup.hidden=!providers.google;
        const google=button('Continue with Google',()=>run(async()=>{await request('beginOAuth',{provider:'google'});return 'Complete Google sign-in in your browser, then return to Timewarp.';}));google.classList.add('timewarp-auth-google');google.prepend(googleMark());
        const divider=el('div',null,'timewarp-auth-divider');divider.append(el('span','or use email'));googleGroup.append(google,divider);card.append(googleGroup);
      }
      const form=el('form',null,'grid gap-4');card.append(form);let name,email,password,repeat,code,consent;
      if(mode==='signUp')name=field(form,'Name','text',false);
      if(mode!=='newPassword'){email=field(form,'Email address','email');email.value=address;email.autocomplete='username';email.maxLength=254;}
      if(['signIn','signUp','newPassword'].includes(mode)){password=field(form,mode==='newPassword'?'New password':'Password','password');password.autocomplete=mode==='signIn'?'current-password':'new-password';if(mode!=='signIn')password.minLength=8;}
      if(['signUp','newPassword'].includes(mode)){repeat=field(form,'Confirm password','password');repeat.autocomplete='new-password';repeat.minLength=8;}
      if(mode==='signUp'){const label=el('label',null,'flex items-start gap-2 text-left text-sm');consent=el('input');consent.type='checkbox';consent.required=true;label.append(consent,el('span','I have read and agree to Timewarp’s Privacy Policy.'));form.append(label);}
      if(mode==='confirm'){code=field(form,'Email code (if provided)','text',false);code.inputMode='numeric';code.autocomplete='one-time-code';code.pattern='[0-9]{6,10}';code.oninput=()=>{code.value=code.value.replace(/[\s-]/g,'');};}
      const submit=button(({signIn:'Sign in',signUp:'Create account',email:'Send sign-in link',confirm:'Verify email code',recovery:'Send reset link',newPassword:'Save new password'})[mode],null,true);submit.type='submit';form.append(submit);
      const actions=el('div',null,'timewarp-auth-actions');card.append(actions);
      const switchMode=next=>{if(busy)return;if(email)address=email.value.trim();if(password)password.value='';if(repeat)repeat.value='';mode=next;render();};
      updateProviders=()=>{if(googleGroup)googleGroup.hidden=!providers.google;if(signup)signup.hidden=!providers.signup;};
      if(mode==='signIn'){
        const links=el('div',null,'timewarp-auth-links');
        signup=button('Create account',()=>switchMode('signUp'));signup.hidden=!providers.signup;links.append(signup);
        links.append(button('Use email link',()=>switchMode('email')),button('Forgot password?',()=>switchMode('recovery')));actions.append(links);
      }else if(mode!=='newPassword')actions.append(button('Back to sign in',()=>switchMode('signIn')));
      if(mode==='confirm')actions.append(button(confirmationPurpose==='email'?'Resend sign-in email':'Resend confirmation',()=>run(async()=>{if(Date.now()<resendAt)throw new Error('Wait a minute before requesting another email.');await request(confirmationPurpose==='email'?'sendOtp':'resendConfirmation',{email:email.value.trim()});resendAt=Date.now()+60000;return confirmationPurpose==='email'?'A fresh sign-in email is on its way. Use the latest link or code.':'If confirmation is needed, a fresh email is on its way.';})));
      const policy=el('a','Privacy Policy','mt-5 inline-block text-xs underline text-muted-foreground');policy.href='https://timewarpdev.com/legal/privacy-policy';policy.onclick=event=>{event.preventDefault();request('openLink',{url:policy.href}).catch(error=>status.textContent=error.message);};card.append(policy);
      async function run(action){if(busy)return;busy=true;card.querySelectorAll('button,input').forEach(node=>node.disabled=true);try{const notice=await action();if(notice)status.textContent=notice;}catch(error){status.textContent=error.message;}finally{busy=false;card.querySelectorAll('button,input').forEach(node=>node.disabled=false);}}
      form.onsubmit=event=>{event.preventDefault();void run(async()=>{
        address=email?.value.trim()||address;if(repeat&&repeat.value!==password.value)throw new Error('The passwords do not match.');
        if(mode==='signIn'){await request('signIn',{email:address,password:password.value});password.value='';if(dialog)container.closest('dialog')?.close();return 'Signed in.';}
        if(mode==='signUp'){const result=await request('signUp',{email:address,password:password.value,name:name.value.trim(),privacyAccepted:consent.checked});password.value='';repeat.value='';if(result.confirmationRequired){confirmationPurpose='signup';mode='confirm';resendAt=Date.now()+60000;render();return;}if(dialog)container.closest('dialog')?.close();return 'Account created.';}
        if(mode==='email'){await request('sendOtp',{email:address});confirmationPurpose='email';mode='confirm';resendAt=Date.now()+60000;render('Open the sign-in link in your email on this computer, or enter the code if one is provided.');return;}
        if(mode==='confirm'){if(!code.value.trim())throw new Error('Open the link in your email, or enter its code.');await request('verifyOtp',{email:address,code:code.value.trim()});code.value='';if(dialog)container.closest('dialog')?.close();return 'Email verified.';}
        if(mode==='recovery'){await request('sendRecovery',{email:address});return 'If an account exists, a reset link is on its way. Open it on this computer to choose a new password.';}
        if(mode==='newPassword'){await request('updatePassword',{password:password.value});password.value='';repeat.value='';if(dialog)container.closest('dialog')?.close();return 'Password updated.';}
      });};
    }
    render();request('authProviders').then(value=>{providers=value;updateProviders();}).catch(()=>{});request('state').then(state=>{if(state.passwordRecovery){mode='newPassword';render();}}).catch(()=>{});
  }
  async function showAccount(){
    const panel=el('dialog',null,'rounded-lg border bg-background p-6 text-foreground shadow-lg');panel.style.cssText='position:fixed;inset:0;margin:auto;width:min(540px,90vw);max-height:90vh;overflow:auto';panel.append(button('Close',()=>panel.close()));document.body.append(panel);panel.showModal();panel.addEventListener('close',()=>{panel.querySelectorAll('input[type="password"]').forEach(input=>input.value='');panel.remove();});
    const body=el('div',null,'mt-5 flex justify-center');panel.append(body);
    try{const state=await request('state');if(!state.user||state.passwordRecovery){mount(body,{dialog:true});return;}const content=el('div',null,'grid w-full gap-4');content.append(el('h2','Account','text-xl font-medium'),el('p',state.user.email,'text-sm'));body.append(content);const balance=el('p','Loading AI credits…','text-sm');content.append(balance,button('Sign out',()=>request('signOut').then(()=>panel.close()).catch(error=>balance.textContent=error.message)));request('cloud',{route:'/billing',data:{}}).then(value=>{if(!Number.isFinite(value.included)||!Number.isFinite(value.purchased))throw new Error();balance.textContent=`AI credits: ${(value.included+value.purchased).toLocaleString(undefined,{maximumFractionDigits:4})}`;}).catch(()=>balance.textContent='Credit balance temporarily unavailable. You can still sign out.');}catch(error){body.append(el('p',error.message));}
  }
  window.timewarpMountAuth=mount;window.timewarpAuth={showAccount};
  window.addEventListener('DOMContentLoaded',()=>{const mountPending=()=>{const view=document.getElementById('timewarp-auth-view');if(view)mount(view);};mountPending();new MutationObserver(mountPending).observe(document.getElementById('root')||document.body,{subtree:true,childList:true});request('state').then(state=>{if(state.passwordRecovery)return showAccount();}).catch(()=>{});});
})();
