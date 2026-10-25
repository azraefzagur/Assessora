import 'dotenv/config';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createServer} from 'node:net';
import pg from 'pg';

const root=process.cwd();
const url=process.env.DATABASE_URL;
if(!url) throw new Error('DATABASE_URL gerekli. Docker Compose veritabanını başlatın.');
const parsed=new URL(url);
if(!['127.0.0.1','localhost'].includes(parsed.hostname)||process.env.NODE_ENV!=='development') throw new Error('Entegrasyon testi yalnız yerel geliştirme PostgreSQL üzerinde çalışır.');
const dbName=`assessora_test_${process.pid}_${Date.now()}`;
const testUrl=new URL(url);testUrl.pathname=`/${dbName}`;
const db=new pg.Pool({connectionString:testUrl.toString()});
const admin=new pg.Client({connectionString:url});
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function port(){const s=createServer();await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));const n=(s.address() as {port:number}).port;await new Promise<void>(r=>s.close(()=>r()));return n;}
function command(args:string[],env:NodeJS.ProcessEnv):Promise<string>{return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx',...args],{cwd:root,env,windowsHide:true});let out='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>out+=x);child.on('exit',code=>code===0?resolve(out):reject(new Error(out)));});}
function cookie(response:Response){return response.headers.get('set-cookie')?.split(';')[0]||'';}
async function startApi(env:NodeJS.ProcessEnv){
  const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:root,env,windowsHide:true});
  let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
  const base=`http://127.0.0.1:${env.API_PORT}`;
  for(let i=0;i<150;i++){try{const r=await fetch(base+'/api/session');if(r.ok)return {child,base,getLog:()=>log};}catch{}await wait(100);}
  child.kill();throw new Error(`API başlamadı: ${log}`);
}
async function stop(child:ChildProcessWithoutNullStreams){if(child.exitCode!==null)return;child.kill();await new Promise<void>(r=>child.once('exit',()=>r()));}
async function fresh(base:string){const response=await fetch(base+'/api/session');assert.equal(response.status,200);return {cookie:cookie(response),csrf:(await response.json()).csrf as string};}
async function post(base:string,path:string,auth:{cookie:string;csrf:string},body:unknown){return fetch(base+path,{method:'POST',headers:{cookie:auth.cookie,'Content-Type':'application/json','X-CSRF-Token':auth.csrf},body:JSON.stringify(body)});}
test('PostgreSQL üzerinde giriş, izolasyon, rol ve aday kodu',async()=>{
  let api:Awaited<ReturnType<typeof startApi>>|undefined,production:Awaited<ReturnType<typeof startApi>>|undefined;
  await admin.connect();
  try{
    await admin.query(`CREATE DATABASE ${dbName}`);
    const env={...process.env,DATABASE_URL:testUrl.toString(),NODE_ENV:'development',MAIL_MODE:'test',APP_PUBLIC_URL:'http://127.0.0.1:5173',API_PORT:String(await port()),SETUP_PASSWORD:'yalniz-test-icin-guclu-sifre'};
    await command(['server/migrate.ts'],env);
    const outA=await command(['server/setup.ts','company','Şirket A','admin-a@ornek.test'],env);
    const outB=await command(['server/setup.ts','company','Şirket B','admin-b@ornek.test'],env);
    const orgA=/Şirket kimliği: ([a-f0-9-]+)/.exec(outA)?.[1],orgB=/Şirket kimliği: ([a-f0-9-]+)/.exec(outB)?.[1];
    assert.ok(orgA&&orgB);
    api=await startApi(env);
    async function login(email:string){const anon=await fresh(api!.base);const result=await post(api!.base,'/api/company/login',anon,{email,password:env.SETUP_PASSWORD});assert.equal(result.status,200);const next=await fetch(api!.base+'/api/session',{headers:{cookie:cookie(result)}});return {cookie:cookie(result),csrf:(await next.json()).csrf as string};}
    const a=await login('admin-a@ornek.test'),b=await login('admin-b@ornek.test');
    const create=await post(api.base,'/api/company/positions',a,{title:'Yazılım geliştirici',description:'Web uygulamaları geliştirme ve bakım.',requirements:[{label:'TypeScript',weight:100,required:true}]});
    assert.equal(create.status,201);const positionA=(await create.json()).id as string;
    const invalidWeight=await post(api.base,'/api/company/positions',a,{title:'Yanlış ağırlık',description:'Yeterli uzunlukta iş tanımı.',requirements:[{label:'SQL',weight:90,required:true}]});
    assert.equal(invalidWeight.status,400);
    const listA=await fetch(api.base+'/api/company/positions',{headers:{cookie:a.cookie}});
    assert.equal((await listA.json()).positions.length,1);
    assert.equal((await fetch(api.base+`/api/company/positions/${positionA}`,{headers:{cookie:b.cookie}})).status,404);
    const listB=await fetch(api.base+'/api/company/positions',{headers:{cookie:b.cookie}});
    assert.equal((await listB.json()).positions.length,0);
    await db.query(`UPDATE memberships SET role='reviewer' WHERE organization_id=$1`,[orgA]);
    assert.equal((await post(api.base,'/api/company/positions',a,{title:'Başka pozisyon',description:'Yeterli uzunlukta iş tanımı.',requirements:[{label:'SQL',weight:100,required:true}]})).status,403);
    await db.query(`UPDATE memberships SET active=false WHERE organization_id=$1`,[orgA]);
    assert.equal((await fetch(api.base+'/api/company/dashboard',{headers:{cookie:a.cookie}})).status,403);
    await db.query(`UPDATE memberships SET active=true,role='admin' WHERE organization_id=$1`,[orgA]);
    const createB=await post(api.base,'/api/company/positions',b,{title:'Veri analisti',description:'Veri analizi ve raporlama görevleri.',requirements:[{label:'SQL',weight:100,required:true}]});
    assert.equal(createB.status,201);const positionB=(await createB.json()).id as string;
    await command(['server/setup.ts','candidate',orgA,positionA,'Aday A','aday-a@ornek.test'],env);
    await command(['server/setup.ts','candidate',orgB,positionB,'Aday B','aday-b@ornek.test'],env);
    const anon=await fresh(api.base);
    const missing=await post(api.base,'/api/candidate/code/request',anon,{email:'kayitsiz@ornek.test'});
    assert.equal(missing.status,200);const missingBody=await missing.json();assert.equal(missingBody.developmentCode,undefined);
    const requested=await post(api.base,'/api/candidate/code/request',anon,{email:'aday-a@ornek.test'});
    assert.equal(requested.status,200);
    const requestedBody=await requested.json();assert.equal(requestedBody.message,missingBody.message);
    const displayed=requestedBody.developmentCode as string;
    assert.match(displayed,/^[0-9]{6}$/);
    const first=displayed;
    await db.query(`UPDATE login_codes SET expires_at=now()-interval '1 second' WHERE candidate_id=(SELECT id FROM candidates WHERE email='aday-a@ornek.test')`);
    assert.equal((await post(api.base,'/api/candidate/code/verify',anon,{email:'aday-a@ornek.test',code:first})).status,401);
    const secondResponse=await post(api.base,'/api/candidate/code/request',anon,{email:'aday-a@ornek.test'});assert.equal(secondResponse.status,200);
    const second=(await secondResponse.json()).developmentCode as string;assert.ok(second);
    const verified=await post(api.base,'/api/candidate/code/verify',anon,{email:'aday-a@ornek.test',code:second});assert.equal(verified.status,200);
    const candidateCookie=cookie(verified);
    const panel=await fetch(api.base+'/api/candidate/applications',{headers:{cookie:candidateCookie}});
    const applications=(await panel.json()).applications as {title:string}[];
    assert.deepEqual(applications.map(x=>x.title),['Yazılım geliştirici']);
    const retry=await fresh(api.base);
    assert.equal((await post(api.base,'/api/candidate/code/verify',retry,{email:'aday-a@ornek.test',code:second})).status,401);
    assert.equal((await post(api.base,'/api/candidate/code/request',retry,{email:'aday-a@ornek.test'})).status,200);
    assert.equal((await post(api.base,'/api/candidate/code/request',retry,{email:'aday-a@ornek.test'})).status,429);
    const wrongSession=await fresh(api.base);
    const bCodeResponse=await post(api.base,'/api/candidate/code/request',wrongSession,{email:'aday-b@ornek.test'});
    const bCode=(await bCodeResponse.json()).developmentCode as string;
    const wrong=bCode==='000000'?'999999':'000000';
    for(let i=0;i<5;i++) assert.equal((await post(api.base,'/api/candidate/code/verify',wrongSession,{email:'aday-b@ornek.test',code:wrong})).status,401);
    assert.equal((await post(api.base,'/api/candidate/code/verify',wrongSession,{email:'aday-b@ornek.test',code:bCode})).status,401);
    const productionEnv={...env,NODE_ENV:'production',MAIL_MODE:'disabled',API_PORT:String(await port())};
    production=await startApi(productionEnv);
    const prodAnon=await fresh(production.base);
    assert.equal((await post(production.base,'/api/company/login',prodAnon,{email:'admin-a@ornek.test',password:env.SETUP_PASSWORD})).status,401);
    assert.equal((await post(production.base,'/api/candidate/code/request',prodAnon,{email:'aday-a@ornek.test'})).status,503);
    assert.equal((await fetch(production.base+'/api/candidate/applications',{headers:{cookie:candidateCookie}})).status,401);
    await assert.rejects(command(['server/index.ts'],{...env,NODE_ENV:'production',MAIL_MODE:'test',API_PORT:String(await port())}),/MAIL_MODE=test yalnız development/);
  }finally{
    if(production) await stop(production.child);
    if(api) await stop(api.child);
    await db.end();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }
});
