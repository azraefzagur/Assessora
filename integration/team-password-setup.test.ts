import 'dotenv/config';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import pg from 'pg';

// #5: Ekip üyesine sabit şifre atanmaz; tek kullanımlık "şifreni belirle" bağlantısı kullanılır.
const root=process.cwd(),source=process.env.DATABASE_URL;
if(!source)throw new Error('DATABASE_URL gerekli.');
const sourceUrl=new URL(source);
if(!['127.0.0.1','localhost'].includes(sourceUrl.hostname)||process.env.NODE_ENV!=='development')throw new Error('Test yalnız yerel geliştirme PostgreSQL üzerinde çalışır.');
const dbName=`assessora_team_${process.pid}_${Date.now()}`,testUrl=new URL(source);testUrl.pathname=`/${dbName}`;
const admin=new pg.Client({connectionString:source});
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){const s=createServer();await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));const port=(s.address() as {port:number}).port;await new Promise<void>(r=>s.close(()=>r()));return port;}
function run(args:string[],env:NodeJS.ProcessEnv){return new Promise<string>((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx',...args],{cwd:root,env,windowsHide:true});let out='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>out+=x);child.once('exit',code=>code===0?resolve(out):reject(new Error(out)));});}
function cookie(response:Response){return response.headers.get('set-cookie')?.split(';')[0]||'';}
async function start(env:NodeJS.ProcessEnv){const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:root,env,windowsHide:true});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);const base=`http://127.0.0.1:${env.API_PORT}`;for(let i=0;i<150;i++){try{const r=await fetch(base+'/api/session');if(r.ok)return {child,base,log:()=>output};}catch{}await wait(100);}child.kill();throw new Error('API başlamadı: '+output);}
async function stop(child:ChildProcessWithoutNullStreams){if(child.exitCode!==null)return;child.kill();await new Promise<void>(r=>child.once('exit',()=>r()));}
async function anonymous(base:string){const r=await fetch(base+'/api/session');return {cookie:cookie(r),csrf:(await r.json()).csrf as string};}
function json(base:string,path:string,auth:{cookie:string;csrf:string},body:unknown,method='POST'){return fetch(base+path,{method,headers:{cookie:auth.cookie,'content-type':'application/json','x-csrf-token':auth.csrf},body:JSON.stringify(body)});}
async function loginStatus(base:string,email:string,password:string){const anon=await anonymous(base);return (await json(base,'/api/company/login',anon,{email,password})).status;}
async function login(base:string,email:string,password:string){const anon=await anonymous(base);const r=await json(base,'/api/company/login',anon,{email,password});assert.equal(r.status,200);const logged={cookie:cookie(r),csrf:''};logged.csrf=(await (await fetch(base+'/api/session',{headers:{cookie:logged.cookie}})).json()).csrf;return logged;}
const tokenOf=(link:string)=>link.split('/').at(-1)!;

test('ekip üyesi: sabit şifre yok, tek kullanımlık şifre belirleme bağlantısı',async()=>{
  let server:Awaited<ReturnType<typeof start>>|undefined;
  const adminPassword=randomBytes(20).toString('base64url');
  const env={...process.env,DATABASE_URL:testUrl.toString(),NODE_ENV:'development',MAIL_MODE:'test',APP_PUBLIC_URL:'http://127.0.0.1:5173',API_PORT:String(await freePort()),SETUP_PASSWORD:adminPassword};
  await admin.connect();
  try{
    await admin.query(`CREATE DATABASE ${dbName}`);
    await run(['server/migrate.ts'],env);
    await run(['server/setup.ts','company','Şirket A','team-admin@ornek.test'],env);
    server=await start(env);const {base}=server;
    const db=new pg.Client({connectionString:testUrl.toString()});await db.connect();
    try{
      const a=await login(base,'team-admin@ornek.test',adminPassword);

      // Boş veritabanında ekip listesi çalışıyor (memberships.created_at eksikti).
      const listed=await fetch(base+'/api/company/team',{headers:{cookie:a.cookie}});
      assert.equal(listed.status,200);

      // İstekle şifre gönderilse bile yok sayılır; sabit şifre atanmaz.
      const added=await json(base,'/api/company/team',a,{email:'yeni-uye@ornek.test',role:'recruiter',password:'Assessora123!'});
      assert.equal(added.status,201);
      const addedBody=await added.json();
      assert.equal(addedBody.setupLinkSent,true);
      assert.match(addedBody.setupLink,/^\/sirket\/sifre-belirle\/[0-9a-f-]{36}\.[0-9a-f]{64}$/);
      assert.equal(await loginStatus(base,'yeni-uye@ornek.test','Assessora123!'),401,'sabit şifreyle giriş yapılamamalı');

      // E-posta işi kuyruğa girdi ve test taşıyıcısı kabul etti.
      let job;for(let i=0;i<40;i++){job=(await db.query("SELECT status FROM email_jobs WHERE kind='password_setup'")).rows[0];if(job?.status==='accepted')break;await wait(100);}
      assert.equal(job?.status,'accepted');

      const team=(await (await fetch(base+'/api/company/team',{headers:{cookie:a.cookie}})).json()).members;
      const pending=team.find((m:{email:string})=>m.email==='yeni-uye@ornek.test');
      assert.equal(pending.setup_pending,true);
      assert.ok(pending.setup_expires_at);

      // Bağlantı bilgisi girişsiz okunabilir; bozuk bağlantı 410.
      const anon=await anonymous(base);
      const firstToken=tokenOf(addedBody.setupLink);
      const info=await fetch(base+'/api/company/password-setup/'+firstToken,{headers:{cookie:anon.cookie}});
      assert.equal(info.status,200);
      assert.equal((await info.json()).email,'yeni-uye@ornek.test');
      assert.equal((await fetch(base+'/api/company/password-setup/'+firstToken.slice(0,-1)+'0',{headers:{cookie:anon.cookie}})).status,410);

      // Yeniden gönderim önceki bağlantıyı geçersiz kılar.
      const resent=await json(base,`/api/company/team/${pending.membership_id}/resend-setup`,a,{});
      assert.equal(resent.status,200);
      const secondToken=tokenOf((await resent.json()).setupLink);
      assert.notEqual(secondToken,firstToken);
      assert.equal((await json(base,'/api/company/password-setup',anon,{token:firstToken,password:'gecerli-yeni-sifre-1'})).status,410,'eski bağlantı geçersiz olmalı');

      // Kısa şifre reddedilir; geçerli şifreyle belirlenir; aynı bağlantı tekrar kullanılamaz.
      assert.equal((await json(base,'/api/company/password-setup',anon,{token:secondToken,password:'kisa'})).status,400);
      assert.equal((await json(base,'/api/company/password-setup',anon,{token:secondToken,password:'gecerli-yeni-sifre-1'})).status,200);
      assert.equal((await json(base,'/api/company/password-setup',anon,{token:secondToken,password:'baska-bir-sifre-22'})).status,410,'bağlantı tek kullanımlık olmalı');
      assert.equal(await loginStatus(base,'yeni-uye@ornek.test','gecerli-yeni-sifre-1'),200);

      // Şifresi belirlenmiş üyeye yeniden gönderim yapılmaz.
      assert.equal((await json(base,`/api/company/team/${pending.membership_id}/resend-setup`,a,{})).status,409);

      // Süresi dolmuş bağlantı reddedilir.
      const late=await json(base,'/api/company/team',a,{email:'gec-kalan@ornek.test',role:'reviewer'});
      const lateToken=tokenOf((await late.json()).setupLink);
      await db.query("UPDATE password_setup_tokens SET expires_at=now()-interval '1 minute' WHERE id=$1",[lateToken.split('.')[0]]);
      assert.equal((await json(base,'/api/company/password-setup',anon,{token:lateToken,password:'gecerli-yeni-sifre-1'})).status,410);

      // Yalnız yönetici üye ekleyebilir.
      const recruiter=await login(base,'yeni-uye@ornek.test','gecerli-yeni-sifre-1');
      assert.equal((await json(base,'/api/company/team',recruiter,{email:'izinsiz@ornek.test',role:'admin'})).status,403);

      // Denetim kayıtları yazıldı.
      const actions=(await db.query("SELECT action FROM audit_logs WHERE action IN ('team_member_added','password_setup_resent','password_setup_completed')")).rows.map(r=>r.action);
      assert.ok(actions.includes('team_member_added')&&actions.includes('password_setup_resent')&&actions.includes('password_setup_completed'));
    }finally{await db.end();}
  }finally{
    if(server)await stop(server.child);
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }
});
