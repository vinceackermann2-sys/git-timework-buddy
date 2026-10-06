"use strict";
// Run after revoking the disposable cloud users and closing the test app.
// Remove only fixture-owned database rows and named encrypted login files.
const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..'),fixtures=JSON.parse(fs.readFileSync(path.join(root,'reports/local-fixtures.private.json'),'utf8'));
if(fixtures.users.length!==2||fixtures.users.some(u=>!u.email.startsWith('timewarp-local-check-')||!['6c2f4268-62f2-4b6b-8ce4-3096fb8f0472','c7c74ba0-73ae-4d4f-851a-f16dd32f8896'].includes(u.id)))throw Error('Unexpected fixtures.');
const profiles=[path.join(process.env.APPDATA,'Timewarp Energy'),path.join(root,'backups/local-harness-profile'),path.join(root,'backups/local-harness-restore-profile')],checks=[];
for(const profile of profiles){
  const file=path.join(profile,'runtime/entities.sqlite');
  if(fs.existsSync(file)){const db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');try{for(const user of fixtures.users){db.prepare('delete from conversations where createdByEntityId=?').run(user.id);db.prepare('delete from agents where ownerUserId=?').run(user.id);}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}finally{db.close();}}
  for(const name of ['timewarp-cloud-session.enc','timewarp-device-token.enc','timewarp-auth-flow.enc','account-session.json','runtime/account-session.json']){const file=path.join(profile,name);if(fs.existsSync(file))fs.unlinkSync(file);}
  checks.push({profile,fixtureRowsRemoved:true,encryptedFixtureLoginRemoved:true});
}
const memory=path.join(profiles[0],'runtime/entities/memories-backup/2a22a89f0cfd106637273eee394538bacf900e86ad879c4f91eef244c1e5c085/user.md');
if(fs.existsSync(memory)&&fs.readFileSync(memory,'utf8')==='# User\n\nThe local acceptance codename is Copper Swallow.\n')fs.unlinkSync(memory);
fs.unlinkSync(path.join(root,'reports/local-fixtures.private.json'));
fs.writeFileSync(path.join(root,'reports/local-fixture-cleanup.json'),JSON.stringify({cleanedAt:new Date().toISOString(),checks},null,2));
console.log('Disposable local chats and login credentials removed; cached tools and other profile data preserved.');
