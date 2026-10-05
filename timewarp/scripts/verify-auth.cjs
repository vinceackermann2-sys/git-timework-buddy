"use strict";
// Integration tests use real Supabase accounts and Windows credential encryption
// in an isolated profile. No user authentication dialog is automated.
const {app,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createAuth}=require('../desktop/auth.cjs'),{sessionStorage}=require('../desktop/session-storage.cjs');
const config=require('../config.json'),root=path.resolve(__dirname,'..');
const fixturesFile=path.join(root,'reports/auth-fixtures.private.json');
const fixtures=JSON.parse(fs.readFileSync(fixturesFile,'utf8'));
const phase=process.argv[2]||'prepare',checks={};
const profile=path.join(root,'backups/acceptance-profile');
const authOnly=path.join(root,'backups/auth-only-profile');
app.setPath('userData',path.join(root,'backups/auth-harness-electron'));
function passed(name,value){checks[name]=!!value;assert.ok(value,name);}
app.whenReady().then(async()=>{
  passed('windowsEncryptionAvailable',safeStorage.isEncryptionAvailable());
  if(phase==='prepare'){
    const storage=sessionStorage(profile,safeStorage),auth=createAuth({config,storage});await auth.init();
    await assert.rejects(auth.signIn({...fixtures.users[0],password:'definitely-incorrect'}));passed('realWrongPasswordRejected',!auth.user());
    await auth.signIn(fixtures.users[0]);passed('realPasswordLogin',!!auth.user()?.id);fixtures.users[0].id=auth.user().id;
    const jwt=await auth.accessToken(),encrypted=fs.readFileSync(path.join(profile,'timewarp-cloud-session.enc'));
    passed('sessionEncryptedOnDisk',!encrypted.includes(Buffer.from(jwt))&&!encrypted.includes(Buffer.from(fixtures.users[0].password)));
    const cache=storage.load();passed('windowsSessionDecrypts',cache.session.access_token===jwt);
    const restored=createAuth({config,storage});await restored.init();passed('loginSurvivesRestart',restored.user().id===auth.user().id);
    storage.save({...cache.session,expires_at:Date.now()/1000-1},cache.capability);
    let refreshRequests=0;const expired=createAuth({config,storage,fetcher:async(url,options)=>{if(url.includes('grant_type=refresh_token'))refreshRequests++;return fetch(url,options);}});await expired.init();await Promise.all([expired.accessToken(),expired.accessToken()]);
    passed('realExpiredSessionRefresh',refreshRequests===1&&storage.load().session.refresh_token!==cache.session.refresh_token);
    await expired.signOut();passed('realSignOutClearsLogin',!expired.user()&&!fs.existsSync(path.join(profile,'timewarp-cloud-session.enc')));
    await expired.signIn(fixtures.users[0]);passed('realLoginAfterLogout',expired.user().id===fixtures.users[0].id);
    const signup=createAuth({config,storage:sessionStorage(authOnly,safeStorage)});await signup.init();
    const result=await signup.signUp({...fixtures.signup,privacyAccepted:true,name:'Disposable acceptance account'});passed('publicSignupRequiresEmailConfirmation',result.confirmationRequired===true&&!signup.user());
  }else{
    const auth=createAuth({config,storage:sessionStorage(authOnly,safeStorage)});await auth.init();
    await assert.rejects(auth.verifyOtp(fixtures.signup.email,'000000'));passed('realInvalidEmailCodeRejected',!auth.user());
    await auth.verifyOtp(fixtures.signup.email,fixtures.signup.emailCode);passed('realSignupEmailConfirmation',auth.user()?.email===fixtures.signup.email);
    await auth.signOut();await auth.signIn(fixtures.signup);passed('confirmedSignupCanLogin',auth.user()?.email===fixtures.signup.email);
    await auth.signOut();await auth.verifyOtp(fixtures.users[0].email,fixtures.users[0].emailCode);passed('realEmailOtpLogin',auth.user()?.email===fixtures.users[0].email);
    await auth.signOut();await auth.verifyOtp(fixtures.users[1].email,fixtures.users[1].recoveryCode,'recovery');passed('realRecoveryCode',auth.passwordRecovery());
    const newPassword=fixtures.users[1].password+'new';await auth.updatePassword(newPassword);passed('realPasswordUpdated',!auth.passwordRecovery());await auth.signOut();await assert.rejects(auth.signIn(fixtures.users[1]));await auth.signIn({...fixtures.users[1],password:newPassword});passed('newPasswordWorksAndOldPasswordRejected',auth.user()?.email===fixtures.users[1].email);
    fixtures.users[1].password=newPassword;await auth.signOut();
  }
  fs.writeFileSync(fixturesFile,JSON.stringify(fixtures),{mode:0o600});
  fs.writeFileSync(path.join(root,`reports/auth-${phase}.json`),JSON.stringify({verifiedAt:new Date().toISOString(),passed:true,checks},null,2));
  console.log(JSON.stringify({passed:true,checks}));app.exit(0);
}).catch(error=>{fs.writeFileSync(path.join(root,`reports/auth-${phase}.json`),JSON.stringify({passed:false,checks,error:error.message},null,2));console.error(JSON.stringify({passed:false,checks,error:error.message}));app.exit(1);});
