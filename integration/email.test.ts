import 'dotenv/config';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import pg from 'pg';

const source=process.env.DATABASE_URL;
if(!source||!['127.0.0.1','localhost'].includes(new URL(source).hostname)||process.env.NODE_ENV!=='development')throw new Error('E-posta testi yerel geliştirme PostgreSQL ister.');
const name=`assessora_email_${process.pid}_${Date.now()}`,url=new URL(source);url.pathname=`/${name}`;
const admin=new pg.Client({connectionString:source});
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function port(){const server=createServer();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const value=(server.address() as {port:number}).port;await new Promise<void>(r=>server.close(()=>r()));return value;}
function command(args:string[],env:NodeJS.ProcessEnv):Promise<string>{return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx',...args],{cwd:process.cwd(),env,windowsHide:true});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);child.once('exit',code=>code===0?resolve(output):reject(new Error(output)));});}
async function start(env:NodeJS.ProcessEnv){const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:process.cwd(),env,windowsHide:true});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);const base=`http://127.0.0.1:${env.API_PORT}`;for(let i=0;i<150;i++){try{if((await fetch(base+'/api/session')).ok)return {child,base};}catch{}await wait(100);}child.kill();throw new Error('API başlamadı: '+output);}
async function stop(child:ChildProcessWithoutNullStreams){if(child.exitCode!==null)return;child.kill();await new Promise<void>(r=>child.once('exit',()=>r()));}
const cookie=(response:Response)=>response.headers.get('set-cookie')?.split(';')[0]||'';
async function session(base:string){const response=await fetch(base+'/api/session');return {cookie:cookie(response),csrf:(await response.json()).csrf as string};}
function post(base:string,path:string,auth:{cookie:string;csrf:string},body:unknown,method='POST'){return fetch(base+path,{method,headers:{cookie:auth.cookie,'content-type':'application/json','x-csrf-token':auth.csrf},body:JSON.stringify(body)});}
async function until(db:pg.Client,id:string,status:string){for(let i=0;i<50;i++){const row=(await db.query('SELECT status,attempt_count FROM email_jobs WHERE invitation_id=$1 OR login_code_id=$1',[id])).rows[0];if(row?.status===status)return row;await wait(100);}throw new Error(`E-posta işi ${status} durumuna geçmedi.`);}

test('kalıcı e-posta işi: başarısızlık, tekrar deneme ve belirsiz sonuç',async()=>{
  const baseEnv={...process.env,DATABASE_URL:url.toString(),NODE_ENV:'development',MAIL_MODE:'test',MAIL_TEST_FAIL:'before_accept',APP_PUBLIC_URL:'http://127.0.0.1:5173',SETUP_PASSWORD:randomBytes(18).toString('base64url')};
  let server:Awaited<ReturnType<typeof start>>|undefined;
  await admin.connect();
  try{
    await admin.query(`CREATE DATABASE ${name}`);
    await command(['server/migrate.ts'],baseEnv);
    await command(['server/setup.ts','company','E-posta Test Şirketi','email-admin@ornek.test'],baseEnv);
    const db=new pg.Client({connectionString:url.toString()});await db.connect();
    try{
      server=await start({...baseEnv,API_PORT:String(await port())});let base=server.base;
      const anon=await session(base),login=await post(base,'/api/company/login',anon,{email:'email-admin@ornek.test',password:baseEnv.SETUP_PASSWORD});assert.equal(login.status,200);
      const auth=await sessionWithCookie(base,cookie(login));
      const created=await post(base,'/api/company/positions',auth,{title:'E-posta test pozisyonu',description:'E-posta işlerini doğrulayan test pozisyonu.',requirements:[{label:'SQL',weight:100,required:true}]});const positionId=(await created.json()).id;
      assert.equal((await post(base,`/api/company/positions/${positionId}`,auth,{title:'E-posta test pozisyonu',description:'E-posta işlerini doğrulayan test pozisyonu.',status:'active',requirements:[{label:'SQL',weight:100,required:true}]},'PUT')).status,200);
      const application=await post(base,'/api/company/applications',auth,{positionId,fullName:'E-posta Test Adayı',email:'email-aday@ornek.test'});const applicationId=(await application.json()).id;
      const candidateSession=await session(base);
      const codeRequest=await post(base,'/api/candidate/code/request',candidateSession,{email:'email-aday@ornek.test'});assert.equal(codeRequest.status,200);const code=(await codeRequest.json()).developmentCode;assert.match(code,/^[0-9]{6}$/);
      const codeId=(await db.query("SELECT id FROM login_codes ORDER BY created_at DESC LIMIT 1")).rows[0].id;
      assert.equal((await until(db,codeId,'failed')).attempt_count,1);
      assert.equal((await post(base,'/api/candidate/code/verify',candidateSession,{email:'email-aday@ornek.test',code})).status,200);
      const expiresAt=new Date(Date.now()+86400000).toISOString();
      const invitation=await post(base,`/api/company/applications/${applicationId}/invitations`,auth,{estimatedMinutes:30,expiresAt});const invitationId=(await invitation.json()).id;
      assert.equal((await post(base,`/api/company/invitations/${invitationId}/send`,auth,{})).status,202);
      assert.equal((await until(db,invitationId,'failed')).attempt_count,1);
      await stop(server.child);server=undefined;
      server=await start({...baseEnv,MAIL_TEST_FAIL:'',API_PORT:String(await port())});base=server.base;
      const reauth=await sessionWithCookie(base,auth.cookie);
      assert.equal((await post(base,`/api/company/invitations/${invitationId}/send`,reauth,{})).status,202);
      assert.equal((await until(db,invitationId,'accepted')).attempt_count,2);
      assert.equal((await post(base,`/api/company/invitations/${invitationId}/send`,reauth,{})).status,200);
      assert.equal((await db.query('SELECT count(*)::int n FROM email_jobs WHERE invitation_id=$1',[invitationId])).rows[0].n,1);
      await stop(server.child);server=undefined;
      await db.query("UPDATE email_jobs SET status='sending',started_at=now()-interval '3 minutes' WHERE invitation_id=$1",[invitationId]);
      await db.query("UPDATE invitations SET delivery_status='sending' WHERE id=$1",[invitationId]);
      server=await start({...baseEnv,MAIL_TEST_FAIL:'',API_PORT:String(await port())});base=server.base;
      assert.equal((await until(db,invitationId,'uncertain')).attempt_count,2);
      assert.equal((await post(base,`/api/company/invitations/${invitationId}/send`,await sessionWithCookie(base,auth.cookie),{})).status,200);
      assert.equal((await db.query('SELECT attempt_count FROM email_jobs WHERE invitation_id=$1',[invitationId])).rows[0].attempt_count,2);
      await stop(server.child);server=undefined;
      server=await start({...baseEnv,MAIL_MODE:'smtp',MAIL_TEST_FAIL:'',SMTP_HOST:'127.0.0.1',SMTP_PORT:'1',SMTP_USER:'test',SMTP_PASSWORD:'test-only',MAIL_FROM:'test@ornek.test',API_PORT:String(await port())});base=server.base;
      const smtpAnon=await session(base);
      const smtpRequest=await post(base,'/api/candidate/code/request',smtpAnon,{email:'email-aday@ornek.test'});
      assert.equal(smtpRequest.status,200);const smtpBody=await smtpRequest.json();assert.equal(smtpBody.developmentCode,undefined);assert.match(smtpBody.message,/uygun bir kayıt varsa/);
      const smtpCodeId=(await db.query('SELECT id FROM login_codes ORDER BY created_at DESC LIMIT 1')).rows[0].id;
      assert.equal((await until(db,smtpCodeId,'failed')).attempt_count,1);
      assert.equal((await post(base,`/api/company/invitations/${invitationId}/send`,await sessionWithCookie(base,auth.cookie),{})).status,503);
    }finally{await db.end();}
  }finally{if(server)await stop(server.child);await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);await admin.end();}
});

async function sessionWithCookie(base:string,value:string){const response=await fetch(base+'/api/session',{headers:{cookie:value}});return {cookie:value,csrf:(await response.json()).csrf as string};}
