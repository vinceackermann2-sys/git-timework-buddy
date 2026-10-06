"use strict";
(() => {
  function createConnectorBrowser({browser,request,createPanel}){
    let active=null,revision=0;
    const checked=result=>{if(!result?.ok)throw new Error(result?.error||'The app browser could not open the connection.');};
    async function close(session=active){
      if(!session||session.closed)return;
      session.closed=true;
      if(active===session)active=null;
      session.unsubscribe?.();session.panel.remove();
      if(session.ownerId)await request('closeConnectorBrowser',{ownerId:session.ownerId});
    }
    async function open(url,{onReady,serverName}={}){
      const link=new URL(url);
      if(link.protocol!=='https:'||link.username||link.password)throw new Error('Invalid app connection link.');
      if(!browser)throw new Error('The app browser is unavailable. Reopen Timewarp and retry.');
      const current=++revision;
      await close();
      if(current!==revision)return;
      const session={ownerId:null,closed:false,state:null,panel:null};
      active=session;
      const navigate=async(method,tabId)=>{
        const selected=tabId||session.state?.selectedTabId;
        if(session.closed||!session.ownerId||!selected)return;
        try{checked(await browser[method]({ownerId:session.ownerId,tabId:selected}));}
        catch(error){if(!session.closed)session.panel.error(error.message);}
      };
      session.panel=createPanel({url:link.href,onClose:()=>close(session).catch(()=>{}),onNavigate:navigate,
        onResize:()=>{if(session.ownerId&&!session.closed)browser.setLayout({ownerId:session.ownerId,layout:session.panel.layout()});}});
      session.unsubscribe=browser.onUpdate(state=>{
        if(state.ownerId!==session.ownerId||session.closed)return;
        session.state=state;session.panel.update(state);
      });
      try{
        const result=await request('openConnectorBrowser',{url:link.href,...serverName?{serverName}:{}});
        session.ownerId=result.ownerId;
        if(session.closed){await request('closeConnectorBrowser',{ownerId:session.ownerId});return;}
        await onReady?.();
        if(session.closed){await request('closeConnectorBrowser',{ownerId:session.ownerId});return;}
        checked(await browser.show({ownerId:session.ownerId,layout:session.panel.layout()}));
        if(session.closed)await request('closeConnectorBrowser',{ownerId:session.ownerId});
      }catch(error){await close(session).catch(()=>{});throw error;}
    }
    return {open,close:()=>{revision++;return close();}};
  }

  if(typeof module==='object'&&module.exports){module.exports={createConnectorBrowser};return;}
  function createPanel({url,onClose,onNavigate,onResize}){
    const previousFocus=document.activeElement;
    const root=document.createElement('div');root.id='timewarp-connector-browser';
    root.style.cssText='position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.55);';
    const panel=document.createElement('section');
    panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Connect app in Timewarp browser');
    panel.style.cssText='display:flex;flex-direction:column;width:min(1100px,100%);height:92%;min-height:240px;border:1px solid var(--color-border,#64748b);border-radius:12px;overflow:hidden;background:var(--color-background,#101827);color:var(--color-foreground,#f8fafc);box-shadow:0 20px 80px #0006;';
    const heading=document.createElement('div');heading.style.cssText='display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--color-border,#64748b);';
    const title=document.createElement('strong');title.textContent='Connect app';title.style.cssText='flex:1;font:600 14px system-ui;';
    const makeButton=(label,action)=>{const button=document.createElement('button');button.type='button';button.className='timewarp-button';button.textContent=label;button.setAttribute('aria-label',label);button.onclick=action;return button;};
    const closeButton=makeButton('Back to apps',onClose);heading.append(title,closeButton);
    const toolbar=document.createElement('div');toolbar.style.cssText='display:flex;align-items:center;gap:8px;padding:8px 14px;';
    const back=makeButton('←',()=>onNavigate('goBack'));back.setAttribute('aria-label','Go back');
    const forward=makeButton('→',()=>onNavigate('goForward'));forward.setAttribute('aria-label','Go forward');
    const reload=makeButton('↻',()=>onNavigate('reload'));reload.setAttribute('aria-label','Reload page');
    back.disabled=forward.disabled=reload.disabled=true;
    const address=document.createElement('input');address.readOnly=true;address.value=url;address.setAttribute('aria-label','Authorization page address');
    address.style.cssText='min-width:0;flex:1;font:13px system-ui;padding:7px 10px;border:1px solid var(--color-border,#64748b);border-radius:6px;background:transparent;color:inherit;';
    toolbar.append(back,forward,reload,address);
    const tabs=document.createElement('div');tabs.style.cssText='display:flex;gap:6px;overflow:auto;padding:0 14px;';
    const status=document.createElement('div');status.textContent='Opening secure connection…';status.setAttribute('role','status');status.style.cssText='font:12px system-ui;padding:6px 14px;';
    const page=document.createElement('div');page.style.cssText='flex:1;min-height:0;background:white;';
    panel.append(heading,toolbar,tabs,status,page);root.append(panel);document.body.append(root);closeButton.focus();
    const bounds=element=>{const {x,y,width,height}=element.getBoundingClientRect();return{x,y,width,height};};
    const resize=new ResizeObserver(onResize);resize.observe(panel);resize.observe(page);
    const key=event=>{if(event.key==='Escape'){event.preventDefault();onClose();}else if(event.key==='Tab'){const controls=[...panel.querySelectorAll('button,input')].filter(item=>!item.disabled);const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};
    window.addEventListener('resize',onResize);window.addEventListener('keydown',key);
    return {
      layout:()=>({pageBounds:bounds(page),surfaceBounds:bounds(panel)}),
      error:message=>{status.textContent=message;},
      update:state=>{
        const selected=state.tabs.find(tab=>tab.id===state.selectedTabId);
        title.textContent=selected?.title||'Connect app';address.value=selected?.url||url;
        back.disabled=!selected?.canGoBack;forward.disabled=!selected?.canGoForward;reload.disabled=!selected;
        status.textContent=selected?.isLoading?'Loading authorization page…':'Complete sign-in and approval here to connect your app.';
        tabs.replaceChildren();
        if(state.tabs.length>1)for(const tab of state.tabs){const button=makeButton(tab.title||'Authorization page',()=>onNavigate('selectTab',tab.id));button.setAttribute('aria-pressed',String(tab.id===state.selectedTabId));tabs.append(button);}
      },
      remove:()=>{resize.disconnect();window.removeEventListener('resize',onResize);window.removeEventListener('keydown',key);root.remove();previousFocus?.focus();},
    };
  }
  let controller;
  window.timewarpOpenConnectorBrowser=(url,options={})=>{
    controller??=createConnectorBrowser({browser:window.newco?.browserView,request:(action,input)=>window.timewarp.request(action,input),createPanel});
    return controller.open(url,{serverName:options.serverName,onReady:async()=>{options.onReady?.();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}});
  };
  window.timewarpCloseConnectorBrowser=()=>controller?.close();
  window.addEventListener('pagehide',()=>{void controller?.close().catch(()=>{});});
})();
