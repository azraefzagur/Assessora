import 'dotenv/config';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import pg from 'pg';

const root=process.cwd(),source=process.env.DATABASE_URL;
if(!source)throw new Error('DATABASE_URL gerekli.');
const sourceUrl=new URL(source);
if(!['127.0.0.1','localhost'].includes(sourceUrl.hostname)||process.env.NODE_ENV!=='development')throw new Error('Test yalnız yerel geliştirme PostgreSQL üzerinde çalışır.');
const dbName=`assessora_stage2_${process.pid}_${Date.now()}`,testUrl=new URL(source);testUrl.pathname=`/${dbName}`;
const admin=new pg.Client({connectionString:source});
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){const s=createServer();await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));const port=(s.address() as {port:number}).port;await new Promise<void>(r=>s.close(()=>r()));return port;}
function run(args:string[],env:NodeJS.ProcessEnv){return new Promise<string>((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx',...args],{cwd:root,env,windowsHide:true});let out='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>out+=x);child.once('exit',code=>code===0?resolve(out):reject(new Error(out)));});}
function cookie(response:Response){return response.headers.get('set-cookie')?.split(';')[0]||'';}
async function start(env:NodeJS.ProcessEnv){const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:root,env,windowsHide:true});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);const base=`http://127.0.0.1:${env.API_PORT}`;for(let i=0;i<150;i++){try{const r=await fetch(base+'/api/session');if(r.ok)return {child,base,log:()=>output};}catch{}await wait(100);}child.kill();throw new Error('API başlamadı: '+output);}
async function stop(child:ChildProcessWithoutNullStreams){if(child.exitCode!==null)return;child.kill();await new Promise<void>(r=>child.once('exit',()=>r()));}
async function anonymous(base:string){const r=await fetch(base+'/api/session');return {cookie:cookie(r),csrf:(await r.json()).csrf as string};}
async function login(base:string,email:string,password:string){const anon=await anonymous(base);const r=await json(base,'/api/company/login',anon,{email,password});assert.equal(r.status,200);const logged={cookie:cookie(r),csrf:''};logged.csrf=(await (await fetch(base+'/api/session',{headers:{cookie:logged.cookie}})).json()).csrf;return logged;}
function json(base:string,path:string,auth:{cookie:string;csrf:string},body:unknown,method='POST'){return fetch(base+path,{method,headers:{cookie:auth.cookie,'content-type':'application/json','x-csrf-token':auth.csrf},body:JSON.stringify(body)});}

test('pozisyon sürümleri, başvuru, özel CV ve süreli davet',async()=>{
  let server:Awaited<ReturnType<typeof start>>|undefined;
  const env={...process.env,DATABASE_URL:testUrl.toString(),NODE_ENV:'development',MAIL_MODE:'test',APP_PUBLIC_URL:'http://127.0.0.1:5173',API_PORT:String(await freePort()),SETUP_PASSWORD:randomBytes(20).toString('base64url')};
  await admin.connect();
  try{
    await admin.query(`CREATE DATABASE ${dbName}`);
    await run(['server/migrate.ts'],env);
    const setupA=await run(['server/setup.ts','company','Şirket A','stage2-a@ornek.test'],env);
    const setupB=await run(['server/setup.ts','company','Şirket B','stage2-b@ornek.test'],env);
    const orgA=/Şirket kimliği: ([a-f0-9-]+)/.exec(setupA)?.[1],orgB=/Şirket kimliği: ([a-f0-9-]+)/.exec(setupB)?.[1];assert.ok(orgA&&orgB);
    server=await start(env);const {base}=server;
    const a=await login(base,'stage2-a@ornek.test',env.SETUP_PASSWORD),b=await login(base,'stage2-b@ornek.test',env.SETUP_PASSWORD);
    const positionBody={title:'Ürün mühendisi',description:'Kurumsal web uygulaması geliştirme.',requirements:[{label:'TypeScript',weight:100,required:true}]};
    const created=await json(base,'/api/company/positions',a,positionBody);assert.equal(created.status,201);const positionId=(await created.json()).id as string;
    const invalid=await json(base,`/api/company/positions/${positionId}`,a,{...positionBody,status:'active',requirements:[{label:'TypeScript',weight:90,required:true}]},'PUT');assert.equal(invalid.status,400);
    const edited=await json(base,`/api/company/positions/${positionId}`,a,{...positionBody,status:'active',requirements:[{label:'TypeScript',weight:60,required:true},{label:'SQL',weight:40,required:false}]},'PUT');assert.equal(edited.status,200);assert.equal((await edited.json()).version,2);
    const detail=await fetch(base+`/api/company/positions/${positionId}`,{headers:{cookie:a.cookie}});const position=await detail.json();assert.equal(position.status,'active');assert.equal(position.requirements.length,2);
    const db=new pg.Client({connectionString:testUrl.toString()});await db.connect();
    try{
      const versions=await db.query('SELECT version_no,count(*)::int n FROM position_requirements WHERE position_id=$1 GROUP BY version_no ORDER BY version_no',[positionId]);assert.deepEqual(versions.rows,[{version_no:1,n:1},{version_no:2,n:2}]);
      const createdApp=await json(base,'/api/company/applications',a,{positionId,fullName:'A Şirketindeki Ad',email:'ortak@ornek.test'});assert.equal(createdApp.status,201);const appA=(await createdApp.json()).id as string;
      assert.equal((await json(base,'/api/company/applications',a,{positionId,fullName:'Tekrar',email:'ortak@ornek.test'})).status,409);
      const posBResponse=await json(base,'/api/company/positions',b,{...positionBody,title:'İkinci şirket pozisyonu'});const posB=(await posBResponse.json()).id as string;
      const appBResponse=await json(base,'/api/company/applications',b,{positionId:posB,fullName:'B Şirketindeki Ad',email:'ortak@ornek.test'});const appB=(await appBResponse.json()).id as string;
      assert.equal((await fetch(base+`/api/company/applications/${appA}`,{headers:{cookie:b.cookie}})).status,404);
      const bDetail=await (await fetch(base+`/api/company/applications/${appB}`,{headers:{cookie:b.cookie}})).json();assert.equal(bDetail.candidate_name,'B Şirketindeki Ad');
      const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
      async function upload(auth:{cookie:string;csrf:string},appId:string,blob:Blob,name:string){const form=new FormData();form.set('file',blob,name);return fetch(base+`/api/company/applications/${appId}/cv`,{method:'POST',headers:{cookie:auth.cookie,'x-csrf-token':auth.csrf},body:form});}
      assert.equal((await upload(a,appA,new Blob(['plain text'],{type:'text/plain'}),'bad.txt')).status,400);
      assert.equal((await upload(a,appA,new Blob([Buffer.alloc(5_000_001)],{type:'application/pdf'}),'large.pdf')).status,413);
      assert.equal((await upload(a,appA,new Blob([pdf],{type:'application/pdf'}),'candidate.pdf')).status,201);
      assert.equal((await upload(a,appA,new Blob([pdf],{type:'application/pdf'}),'candidate.pdf')).status,409);
      const ownCv=await fetch(base+`/api/company/applications/${appA}/cv`,{headers:{cookie:a.cookie}});assert.equal(ownCv.status,200);assert.deepEqual(Buffer.from(await ownCv.arrayBuffer()),pdf);
      assert.equal((await fetch(base+`/api/company/applications/${appA}/cv`,{headers:{cookie:b.cookie}})).status,404);
      assert.equal((await fetch(base+`/api/company/applications/${appA}/cv`)).status,401);
      const expiresAt=new Date(Date.now()+24*60*60*1000).toISOString();
      const invited=await json(base,`/api/company/applications/${appA}/invitations`,a,{estimatedMinutes:45,expiresAt});assert.equal(invited.status,201);const invite=await invited.json();assert.equal(invite.delivery_status,'not_sent');assert.ok(invite.test_link);
      assert.equal((await json(base,`/api/company/applications/${appA}/invitations`,a,{estimatedMinutes:45,expiresAt})).status,409);
      assert.equal((await json(base,`/api/company/invitations/${invite.id}/send`,b,{})).status,404);
      const queued=await json(base,`/api/company/invitations/${invite.id}/send`,a,{});assert.equal(queued.status,202);
      for(let i=0;i<30;i++){const state=(await db.query('SELECT status FROM email_jobs WHERE invitation_id=$1',[invite.id])).rows[0]?.status;if(state==='accepted')break;await wait(100);}
      assert.equal((await db.query('SELECT status,attempt_count FROM email_jobs WHERE invitation_id=$1',[invite.id])).rows[0].status,'accepted');
      assert.equal((await json(base,`/api/company/invitations/${invite.id}/send`,a,{})).status,200);
      assert.equal((await db.query('SELECT count(*)::int n FROM email_jobs WHERE invitation_id=$1',[invite.id])).rows[0].n,1);
      const anon=await anonymous(base);assert.equal((await fetch(base+'/api/candidate/invitations/'+invite.test_link.split('/').at(-1),{headers:{cookie:anon.cookie}})).status,401);
      const codeRequest=await json(base,'/api/candidate/code/request',anon,{email:'ortak@ornek.test'});assert.equal(codeRequest.status,200);const code=(await codeRequest.json()).developmentCode as string;assert.ok(code);
      const verified=await json(base,'/api/candidate/code/verify',anon,{email:'ortak@ornek.test',code});assert.equal(verified.status,200);const candidateCookie=cookie(verified);
      const candidateApps=await (await fetch(base+'/api/candidate/applications',{headers:{cookie:candidateCookie}})).json();assert.equal(candidateApps.applications.length,2);
      const candidateInvites=await (await fetch(base+'/api/candidate/invitations',{headers:{cookie:candidateCookie}})).json();assert.equal(candidateInvites.invitations.length,1);
      const invitePath=candidateInvites.invitations[0].path as string;assert.equal((await fetch(base+'/api/candidate/invitations/'+invitePath.split('/').at(-1),{headers:{cookie:candidateCookie}})).status,200);
      const otherApp=await json(base,'/api/company/applications',b,{positionId:posB,fullName:'Başka Aday',email:'baska@ornek.test'});const otherAppId=(await otherApp.json()).id as string;
      assert.equal((await upload(b,appB,new Blob([pdf],{type:'application/pdf'}),'b-aday.pdf')).status,201);
      await db.query("UPDATE memberships SET role='reviewer' WHERE organization_id=$1",[orgB]);
      assert.equal((await fetch(base+`/api/company/applications/${appB}/cv`,{headers:{cookie:b.cookie}})).status,200);
      assert.equal((await fetch(base+`/api/company/applications/${appA}/cv`,{headers:{cookie:b.cookie}})).status,404);
      assert.equal((await upload(b,appB,new Blob([pdf],{type:'application/pdf'}),'new.pdf')).status,403);
      assert.equal((await json(base,`/api/company/applications/${appB}/invitations`,b,{estimatedMinutes:30,expiresAt})).status,403);
      assert.equal((await json(base,`/api/company/invitations/${invite.id}/send`,b,{})).status,403);
      assert.equal((await json(base,'/api/company/applications',b,{positionId:posB,fullName:'Yetkisiz',email:'yetkisiz@ornek.test'})).status,403);
      const otherCandidateId=(await db.query('SELECT candidate_id FROM applications WHERE id=$1',[otherAppId])).rows[0].candidate_id as string;
      assert.notEqual(otherCandidateId,null);
      const otherAnon=await anonymous(base);const otherCodeResponse=await json(base,'/api/candidate/code/request',otherAnon,{email:'baska@ornek.test'});const otherCode=(await otherCodeResponse.json()).developmentCode as string;assert.ok(otherCode);
      const otherVerified=await json(base,'/api/candidate/code/verify',otherAnon,{email:'baska@ornek.test',code:otherCode});const otherCookie=cookie(otherVerified);
      assert.equal((await fetch(base+'/api/candidate/invitations/'+invitePath.split('/').at(-1),{headers:{cookie:otherCookie}})).status,404);
      assert.equal((await fetch(base+`/api/candidate/applications/${appA}`,{headers:{cookie:otherCookie}})).status,404);
      assert.equal((await fetch(base+`/api/company/applications/${appA}/cv`,{headers:{cookie:otherCookie}})).status,401);
      assert.equal((await json(base,`/api/company/invitations/${invite.id}/cancel`,a,{})).status,200);
      assert.equal((await fetch(base+'/api/candidate/invitations/'+invitePath.split('/').at(-1),{headers:{cookie:candidateCookie}})).status,410);
      assert.equal((await (await fetch(base+'/api/candidate/invitations',{headers:{cookie:candidateCookie}})).json()).invitations.length,0);
      const second=await json(base,`/api/company/applications/${appA}/invitations`,a,{estimatedMinutes:30,expiresAt});assert.equal(second.status,201);const secondInvite=await second.json(),secondId=secondInvite.id as string,secondToken=(secondInvite.test_link as string).split('/').at(-1);
      await db.query("UPDATE invitations SET expires_at=now()-interval '1 minute' WHERE id=$1",[secondId]);
      const expiredToken=(await (await fetch(base+`/api/company/invitations/${secondId}`,{headers:{cookie:a.cookie}})).json()).test_link;
      assert.equal(expiredToken,null);
      assert.equal((await json(base,`/api/company/invitations/${secondId}/send`,a,{})).status,409);
      assert.equal((await fetch(base+'/api/candidate/invitations/'+secondToken,{headers:{cookie:candidateCookie}})).status,410);
      assert.equal((await (await fetch(base+'/api/candidate/invitations',{headers:{cookie:candidateCookie}})).json()).invitations.length,0);
      assert.equal((await json(base,`/api/company/applications/${appA}/invitations`,a,{estimatedMinutes:10,expiresAt})).status,400);
      const third=await json(base,`/api/company/applications/${appA}/invitations`,a,{estimatedMinutes:30,expiresAt});assert.equal(third.status,201);
      const thirdPath=(await third.json()).test_link as string;
      assert.equal((await json(base,`/api/company/positions/${positionId}`,a,{...positionBody,status:'closed',requirements:[{label:'TypeScript',weight:60,required:true},{label:'SQL',weight:40,required:false}]},'PUT')).status,200);
      assert.equal((await fetch(base+'/api/candidate/invitations/'+thirdPath.split('/').at(-1),{headers:{cookie:candidateCookie}})).status,410);
      const thirdId=(thirdPath.split('/').at(-1)||'').split('.')[0];assert.equal((await json(base,`/api/company/invitations/${thirdId}/send`,a,{})).status,409);
      assert.equal((await json(base,`/api/company/applications/${appA}/invitations`,a,{estimatedMinutes:30,expiresAt})).status,400);
      assert.equal((await json(base,'/api/company/applications',a,{positionId,fullName:'Yeni Aday',email:'yeni@ornek.test'})).status,400);
    }finally{await db.end();}
  }finally{
    if(server)await stop(server.child);
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }
});
