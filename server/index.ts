import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { resolve } from 'node:path';
import { pool, transaction } from './db.ts';
import { newId, verifyPassword, createSession, findSession, setSessionCookie, csrfValid } from './security.ts';
import { parsePosition, ValidationError, HttpError, uuidPattern } from './validation.ts';
import { registerStage2 } from './stage2.ts';
import { registerStage3 } from './stage3.ts';
import {codeForId,codeHash,generalCodeMessage,limitHash,mailMode,processEmailJobs,startEmailWorker} from './email.ts';
import type { Membership } from './types.ts';

const app=express();
app.disable('x-powered-by');
if(process.env.TRUST_PROXY==='true') app.set('trust proxy',1);
app.use(express.json({limit:'30kb'}));
const mailFormat=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.use(async(req,res,next)=>{
  try {
    res.set('Cache-Control','no-store');
    res.set('X-Content-Type-Options','nosniff');
    res.set('Referrer-Policy','strict-origin-when-cross-origin');
    const token=/(?:^|; )assessora_session=([^;]+)/.exec(req.headers.cookie||'')?.[1];
    let session=await findSession(token);
    if(!session){const fresh=await createSession();session=fresh.session;setSessionCookie(res,fresh.token);}
    req.session=session;
    next();
  } catch(error){next(error);}
});
app.use((req,res,next)=>{
  if(req.method==='GET'||req.method==='HEAD'||req.method==='OPTIONS') return next();
  if(!csrfValid(req.header('x-csrf-token'),req.session.csrf_token)) return res.status(403).json({error:'Geçersiz istek. Sayfayı yenileyin.'});
  next();
});
const asyncRoute=(handler:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{Promise.resolve(handler(req,res)).catch(next);};
async function rotate(req:Request,res:Response,type:'company'|'candidate',id:string,orgId:string|null=null){
  await pool.query('DELETE FROM sessions WHERE id_hash=$1',[req.session.id_hash]);
  const fresh=await createSession(type,id,orgId);
  setSessionCookie(res,fresh.token);
}
async function company(req:Request,res:Response,next:NextFunction,roles:Membership['role'][]=['admin','recruiter','reviewer']){
  if(req.session.actor_type!=='company'||!req.session.organization_id||!req.session.actor_id) return res.status(401).json({error:'Şirket girişi gerekli.'});
  try{
    const {rows}=await pool.query<Membership>('SELECT m.role,o.name FROM memberships m JOIN organizations o ON o.id=m.organization_id JOIN users u ON u.id=m.user_id WHERE m.user_id=$1 AND m.organization_id=$2 AND m.active=true AND ($3::boolean OR u.development_only=false)',[req.session.actor_id,req.session.organization_id,process.env.NODE_ENV==='development']);
    if(!rows[0]||!roles.includes(rows[0].role)) return res.status(403).json({error:'Bu işlem için yetkiniz yok.'});
    req.membership=rows[0];next();
  }catch(error){next(error);}
}
function requireCompany(roles?:Membership['role'][]){return (req:Request,res:Response,next:NextFunction)=>{void company(req,res,next,roles);};}
function candidate(req:Request,res:Response,next:NextFunction){
  if(req.session.actor_type!=='candidate'||!req.session.actor_id) return res.status(401).json({error:'Aday girişi gerekli.'});
  next();
}

app.get('/api/session',asyncRoute(async(req,res)=>{
  let actor=req.session.actor_type;
  if(actor==='company'){
    const {rows}=await pool.query('SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=$1 AND m.organization_id=$2 AND m.active=true AND ($3::boolean OR u.development_only=false)',[req.session.actor_id,req.session.organization_id,process.env.NODE_ENV==='development']);
    if(!rows.length) actor=null;
  }else if(actor==='candidate'){
    const {rows}=await pool.query('SELECT 1 FROM candidates WHERE id=$1',[req.session.actor_id]);
    if(!rows.length) actor=null;
  }
  res.json({actor,csrf:req.session.csrf_token,mailMode});
}));
app.post('/api/company/login',asyncRoute(async(req,res)=>{
  const email=String(req.body?.email||'').trim().toLowerCase(),password=String(req.body?.password||'');
  if(email.length>254||password.length>1024) return res.status(401).json({error:'E-posta veya şifre hatalı.'});
  const {rows}=await pool.query<{id:string;password_hash:string;organization_id:string}>('SELECT u.id,u.password_hash,m.organization_id FROM users u JOIN memberships m ON m.user_id=u.id AND m.active=true WHERE lower(u.email)=$1 AND ($2::boolean OR u.development_only=false) ORDER BY m.organization_id LIMIT 1',[email,process.env.NODE_ENV==='development']);
  if(!rows[0]||!verifyPassword(password,rows[0].password_hash)) return res.status(401).json({error:'E-posta veya şifre hatalı.'});
  await rotate(req,res,'company',rows[0].id,rows[0].organization_id);
  res.json({ok:true});
}));
app.post('/api/logout',asyncRoute(async(req,res)=>{
  await pool.query('DELETE FROM sessions WHERE id_hash=$1',[req.session.id_hash]);
  const fresh=await createSession();setSessionCookie(res,fresh.token);res.json({ok:true});
}));
app.get('/api/company/dashboard',requireCompany(),asyncRoute(async(req,res)=>{
  const org=req.session.organization_id;
  const [positions,applications,recent]=await Promise.all([
    pool.query('SELECT count(*)::int AS count FROM positions WHERE organization_id=$1',[org]),
    pool.query('SELECT count(*)::int AS count FROM applications WHERE organization_id=$1',[org]),
    pool.query('SELECT id,title,status,created_at FROM positions WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 5',[org])
  ]);
  res.json({organization:req.membership?.name,role:req.membership?.role,positionCount:positions.rows[0].count,applicationCount:applications.rows[0].count,recent:recent.rows});
}));
app.get('/api/company/positions',requireCompany(),asyncRoute(async(req,res)=>{
  const {rows}=await pool.query('SELECT p.id,p.title,p.status,p.created_at,count(a.id)::int AS applicant_count FROM positions p LEFT JOIN applications a ON a.position_id=p.id AND a.organization_id=p.organization_id WHERE p.organization_id=$1 GROUP BY p.id ORDER BY p.created_at DESC',[req.session.organization_id]);
  res.json({positions:rows,role:req.membership?.role,organization:req.membership?.name});
}));
app.post('/api/company/positions',requireCompany(['admin','recruiter']),asyncRoute(async(req,res)=>{
  const input=parsePosition(req.body);
  const org=req.session.organization_id!,id=newId();
  await transaction(async client=>{
    await client.query('INSERT INTO positions (id,organization_id,title,description,created_by_user_id) VALUES ($1,$2,$3,$4,$5)',[id,org,input.title,input.description,req.session.actor_id]);
    await client.query('INSERT INTO position_versions (position_id,organization_id,version_no,title,description,created_by_user_id) VALUES ($1,$2,1,$3,$4,$5)',[id,org,input.title,input.description,req.session.actor_id]);
    for(const [i,r] of input.requirements.entries()) await client.query('INSERT INTO position_requirements (id,organization_id,position_id,version_no,label,required,weight,sort_order) VALUES ($1,$2,$3,1,$4,$5,$6,$7)',[newId(),org,id,r.label,r.required,r.weight,i]);
  });
  res.status(201).json({id});
}));
app.get('/api/company/positions/:id',requireCompany(),asyncRoute(async(req,res)=>{
  const id=req.params.id;
  if(typeof id!=='string'||!uuidPattern.test(id)) return res.status(404).json({error:'Pozisyon bulunamadı.'});
  const {rows}=await pool.query('SELECT id,title,description,status,current_version,created_at FROM positions WHERE id=$1 AND organization_id=$2',[id,req.session.organization_id]);
  if(!rows[0]) return res.status(404).json({error:'Pozisyon bulunamadı.'});
  const requirements=await pool.query('SELECT id,label,required,weight FROM position_requirements WHERE position_id=$1 AND organization_id=$2 AND version_no=$3 ORDER BY sort_order',[id,req.session.organization_id,rows[0].current_version]);
  res.json({...rows[0],requirements:requirements.rows,organization:req.membership?.name,role:req.membership?.role});
}));
app.post('/api/candidate/code/request',asyncRoute(async(req,res)=>{
  const email=String(req.body?.email||'').trim().toLowerCase();
  if(!mailFormat.test(email)||email.length>254) return res.status(400).json({error:'Geçerli bir e-posta adresi girin.'});
  if(mailMode==='disabled') return res.status(503).json({error:'E-posta gönderimi yapılandırılmadı.'});
  const emailHash=limitHash('email',email),ipHash=limitHash('ip',req.ip||'unknown');
  const result=await transaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[emailHash]);
    const counts=await client.query<{email_count:number;ip_count:number}>(`SELECT count(*) FILTER (WHERE email_hash=$1 AND created_at>now()-interval '10 minutes')::int AS email_count,
      count(*) FILTER (WHERE ip_hash=$2 AND created_at>now()-interval '1 hour')::int AS ip_count FROM code_request_limits`,[emailHash,ipHash]);
    if(counts.rows[0].email_count>=3||counts.rows[0].ip_count>=20)return {limited:true,codeId:null};
    await client.query('INSERT INTO code_request_limits (id,email_hash,ip_hash) VALUES ($1,$2,$3)',[newId(),emailHash,ipHash]);
    const candidate=(await client.query<{id:string}>('SELECT id FROM candidates WHERE lower(email)=$1',[email])).rows[0];
    if(!candidate)return {limited:false,codeId:null};
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[candidate.id]);
    const previous=(await client.query<{code_hash:string}>('SELECT code_hash FROM login_codes WHERE candidate_id=$1 ORDER BY created_at DESC LIMIT 1',[candidate.id])).rows[0];
    await client.query('UPDATE login_codes SET consumed_at=now() WHERE candidate_id=$1 AND consumed_at IS NULL',[candidate.id]);
    let codeId=newId(),code=codeForId(codeId);
    while(previous?.code_hash===codeHash(candidate.id,code)){codeId=newId();code=codeForId(codeId);}
    await client.query("INSERT INTO login_codes (id,candidate_id,code_hash,expires_at) VALUES ($1,$2,$3,now()+interval '10 minutes')",[codeId,candidate.id,codeHash(candidate.id,code)]);
    await client.query("INSERT INTO email_jobs (id,kind,login_code_id) VALUES ($1,'login_code',$2)",[newId(),codeId]);
    return {limited:false,codeId};
  });
  if(result.limited)return res.status(429).json({error:'Çok fazla kod istendi. Bir süre sonra yeniden deneyin.'});
  void processEmailJobs().catch(()=>console.error('E-posta işi işlenemedi.'));
  res.json({message:generalCodeMessage,...(mailMode==='test'&&result.codeId?{developmentCode:codeForId(result.codeId)}:{})});
}));
app.post('/api/candidate/code/verify',asyncRoute(async(req,res)=>{
  if(mailMode==='disabled') return res.status(503).json({error:'E-posta doğrulaması yapılandırılmadı.'});
  const email=String(req.body?.email||'').trim().toLowerCase(),code=String(req.body?.code||'');
  if(!mailFormat.test(email)||!/^[0-9]{6}$/.test(code)) return res.status(401).json({error:'Kod geçersiz veya süresi doldu.'});
  const {rows}=await pool.query<{id:string}>('SELECT id FROM candidates WHERE lower(email)=$1',[email]);
  if(!rows[0]) return res.status(401).json({error:'Kod geçersiz veya süresi doldu.'});
  const candidateId=rows[0].id;
  const updated=await pool.query<{candidate_id:string}>(`UPDATE login_codes SET consumed_at=now() WHERE id=(SELECT id FROM login_codes WHERE candidate_id=$1 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1) AND code_hash=$2 AND expires_at>now() AND attempts<5 AND consumed_at IS NULL RETURNING candidate_id`,[candidateId,codeHash(candidateId,code)]);
  if(!updated.rows[0]){
    await pool.query('UPDATE login_codes SET attempts=attempts+1 WHERE id=(SELECT id FROM login_codes WHERE candidate_id=$1 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1) AND attempts<5',[candidateId]);
    return res.status(401).json({error:'Kod geçersiz veya süresi doldu.'});
  }
  await rotate(req,res,'candidate',candidateId);
  res.json({ok:true});
}));
app.get('/api/candidate/applications',candidate,asyncRoute(async(req,res)=>{
  const found=await pool.query<{full_name:string}>('SELECT full_name FROM candidates WHERE id=$1',[req.session.actor_id]);
  if(!found.rows[0]) return res.status(403).json({error:'Aday erişimi kaldırıldı.'});
  const {rows}=await pool.query('SELECT a.id,a.status,a.created_at,p.title,o.name AS organization_name FROM applications a JOIN positions p ON p.id=a.position_id AND p.organization_id=a.organization_id JOIN organizations o ON o.id=a.organization_id WHERE a.candidate_id=$1 ORDER BY a.created_at DESC',[req.session.actor_id]);
  res.json({name:found.rows[0].full_name,applications:rows});
}));
registerStage2(app,requireCompany,candidate);
registerStage3(app,requireCompany,candidate);
app.use('/api',(_req,res)=>res.status(404).json({error:'Sayfa bulunamadı.'}));
if(process.env.NODE_ENV==='production'){
  app.use(express.static(resolve('dist')));
  app.get('/{*path}',(_req,res)=>res.sendFile(resolve('dist/index.html')));
}
app.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{
  if(error instanceof ValidationError) return res.status(400).json({error:error.message});
  if(error instanceof HttpError) return res.status(error.status).json({error:error.message});
  if(error instanceof multer.MulterError) return res.status(error.code==='LIMIT_FILE_SIZE'?413:400).json({error:error.code==='LIMIT_FILE_SIZE'?'PDF en fazla 5 MB olabilir.':'Dosya yükleme sınırı aşıldı.'});
  console.error(error);res.status(500).json({error:'Sunucu hatası.'});
});
const port=Number(process.env.API_PORT||3001);
if(!Number.isInteger(port)||port<1||port>65535) throw new Error('API_PORT geçersiz');
await pool.query('SELECT name FROM schema_migrations LIMIT 1');
await pool.query('SELECT id FROM email_jobs LIMIT 1');
startEmailWorker();
app.listen(port,'127.0.0.1',()=>console.log(`API: http://127.0.0.1:${port}`));
