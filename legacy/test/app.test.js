import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import Database from 'better-sqlite3';

const root = process.cwd();
const idFromUrl = location => /\/sirket\/pozisyonlar\/([a-f0-9-]+)$/.exec(location)?.[1];
const csrfFrom = html => /name="_csrf" value="([a-f0-9]+)"/.exec(html)?.[1];
const cookieFrom = response => response.headers.get('set-cookie')?.split(';')[0];
function run(command, args, env) {
  return new Promise((resolve,reject) => {
    const child=spawn(command,args,{cwd:root,env,windowsHide:true});
    let out='';
    child.stdout.on('data',x=>out+=x);
    child.stderr.on('data',x=>out+=x);
    child.on('exit',code=>code===0?resolve(out):reject(new Error(out)));
  });
}
async function freePort() {
  const server=createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}
test('şirket izolasyonu, rol ve aday oturumu', async () => {
  const dir=mkdtempSync(join(tmpdir(),'assessora-test-'));
  const port=await freePort();
  const env={...process.env,DATABASE_PATH:join(dir,'test.db'),NODE_ENV:'development',PORT:String(port)};
  let child;
  let sqlite;
  try {
    const outA=await run(process.execPath,['legacy/src/setup.js','company','Şirket A','a@ornek.test','birinci-guclu-sifre'],env);
    const outB=await run(process.execPath,['legacy/src/setup.js','company','Şirket B','b@ornek.test','ikinci-guclu-sifre'],env);
    const orgA=/Şirket kimliği: ([a-f0-9-]+)/.exec(outA)?.[1];
    const orgB=/Şirket kimliği: ([a-f0-9-]+)/.exec(outB)?.[1];
    assert.ok(orgA && orgB);
    child=spawn(process.execPath,['legacy/src/server.js'],{cwd:root,env,windowsHide:true});
    let log=''; child.stdout.on('data',x=>log+=x); child.stderr.on('data',x=>log+=x);
    const base=`http://127.0.0.1:${port}`;
    for(let i=0;i<50;i++){
      try { await fetch(base+'/sirket/giris'); break; } catch { await new Promise(r=>setTimeout(r,100)); }
    }
    async function login(email,password){
      const page=await fetch(base+'/sirket/giris');
      const cookie=cookieFrom(page), csrf=csrfFrom(await page.text());
      const response=await fetch(base+'/sirket/giris',{method:'POST',headers:{cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:csrf,email,password}),redirect:'manual'});
      assert.equal(response.status,302,log);
      return cookieFrom(response);
    }
    const cookieA=await login('a@ornek.test','birinci-guclu-sifre');
    const cookieB=await login('b@ornek.test','ikinci-guclu-sifre');
    const form=await fetch(base+'/sirket/pozisyonlar/yeni',{headers:{cookie:cookieA}});
    const csrf=csrfFrom(await form.text());
    const create=await fetch(base+'/sirket/pozisyonlar',{method:'POST',headers:{cookie:cookieA,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:csrf,title:'Yazılım geliştirici',description:'Web uygulamaları geliştirme ve bakım.',label0:'JavaScript',weight0:'100',required0:'1'}),redirect:'manual'});
    assert.equal(create.status,302,log);
    const positionId=idFromUrl(create.headers.get('location'));
    assert.ok(positionId);
    const detailB=await fetch(base+`/sirket/pozisyonlar/${positionId}`,{headers:{cookie:cookieB}});
    assert.equal(detailB.status,404);
    const listB=await fetch(base+'/sirket/pozisyonlar',{headers:{cookie:cookieB}});
    assert.ok(!(await listB.text()).includes('Yazılım geliştirici'));
    sqlite=new Database(env.DATABASE_PATH);
    sqlite.prepare("UPDATE memberships SET role='reviewer' WHERE organization_id=?").run(orgA);
    const reviewerWrite=await fetch(base+'/sirket/pozisyonlar',{method:'POST',headers:{cookie:cookieA,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:csrf,title:'İkinci pozisyon',description:'İkinci pozisyon için yeterli iş tanımı.',label0:'SQL',weight0:'100'})});
    assert.equal(reviewerWrite.status,403);
    sqlite.prepare("UPDATE memberships SET role='admin',active=0 WHERE organization_id=?").run(orgA);
    const revoked=await fetch(base+'/sirket',{headers:{cookie:cookieA}});
    assert.equal(revoked.status,403);
    sqlite.prepare('UPDATE memberships SET active=1 WHERE organization_id=?').run(orgA);
    await run(process.execPath,['legacy/src/setup.js','candidate',orgA,positionId,'Test Aday','aday@ornek.test'],env);
    const entry=await fetch(base+'/aday/giris');
    const candidateCookie=cookieFrom(entry), candidateCsrf=csrfFrom(await entry.text());
    const codeResponse=await fetch(base+'/aday/kod-iste',{method:'POST',headers:{cookie:candidateCookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:candidateCsrf,email:'aday@ornek.test'})});
    assert.equal(codeResponse.status,200);
    await new Promise(r=>setTimeout(r,100));
    const firstCode=/giriş kodu: ([0-9]{6})/.exec(log)?.[1];
    assert.ok(firstCode,log);
    sqlite.prepare('UPDATE login_codes SET expires_at=?').run(Date.now()-1);
    const expired=await fetch(base+'/aday/dogrula',{method:'POST',headers:{cookie:candidateCookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:candidateCsrf,email:'aday@ornek.test',code:firstCode})});
    assert.equal(expired.status,401);
    await fetch(base+'/aday/kod-iste',{method:'POST',headers:{cookie:candidateCookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:candidateCsrf,email:'aday@ornek.test'})});
    await new Promise(r=>setTimeout(r,100));
    const code=[...log.matchAll(/giriş kodu: ([0-9]{6})/g)].at(-1)?.[1];
    assert.ok(code,log);
    const verify=await fetch(base+'/aday/dogrula',{method:'POST',headers:{cookie:candidateCookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:candidateCsrf,email:'aday@ornek.test',code}),redirect:'manual'});
    assert.equal(verify.status,302);
    const candidateSession=cookieFrom(verify);
    const panel=await fetch(base+'/aday',{headers:{cookie:candidateSession}});
    assert.ok((await panel.text()).includes('Yazılım geliştirici'));
    const retryPage=await fetch(base+'/aday/giris',{headers:{cookie:candidateCookie}});
    const retryCookie=cookieFrom(retryPage) || candidateCookie;
    const retryCsrf=csrfFrom(await retryPage.text());
    const reuse=await fetch(base+'/aday/dogrula',{method:'POST',headers:{cookie:retryCookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:retryCsrf,email:'aday@ornek.test',code})});
    assert.equal(reuse.status,401);
    const crossCreate=await run(process.execPath,['legacy/src/setup.js','candidate',orgB,positionId,'Başka Aday','baska@ornek.test'],env).then(()=>true,()=>false);
    assert.equal(crossCreate,false);
  } finally {
    if(child){child.kill(); await new Promise(r=>child.once('exit',r));}
    sqlite?.close();
    rmSync(dir,{recursive:true,force:true});
  }
});
