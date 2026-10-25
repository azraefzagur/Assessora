import 'dotenv/config';
import {createHmac} from 'node:crypto';
import nodemailer from 'nodemailer';
import {pool,transaction} from './db.ts';
import {invitationToken} from './invitation.ts';

type MailMode='disabled'|'test'|'smtp';
const rawMode=process.env.MAIL_MODE||'disabled';
if(!['disabled','test','smtp'].includes(rawMode)) throw new Error('MAIL_MODE disabled, test veya smtp olmalı.');
export const mailMode=rawMode as MailMode;
if(mailMode==='test'&&process.env.NODE_ENV!=='development') throw new Error('MAIL_MODE=test yalnız development ortamında kullanılabilir.');
const codeKey=process.env.CODE_SIGNING_KEY||'';
if(codeKey.length<32||codeKey.startsWith('replace-with-')) throw new Error('CODE_SIGNING_KEY rastgele ve en az 32 karakter olmalı.');
const from=process.env.MAIL_FROM||'';
const publicUrl=process.env.APP_PUBLIC_URL||'';
const smtpPort=Number(process.env.SMTP_PORT||587);
if(mailMode==='smtp'&&(!process.env.SMTP_HOST||!process.env.SMTP_USER||!process.env.SMTP_PASSWORD||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)||!Number.isInteger(smtpPort)||smtpPort<1||smtpPort>65535)) throw new Error('SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD ve MAIL_FROM .env içinde gerekli.');
export function publicInvitationBase():string|null{
  try{
    const url=new URL(publicUrl);
    if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!['http:','https:'].includes(url.protocol))return null;
    if(mailMode==='smtp'&&(url.protocol!=='https:'||['localhost','127.0.0.1','::1'].includes(url.hostname)))return null;
    return url.origin;
  }catch{return null;}
}
export function codeForId(id:string):string{
  const digest=createHmac('sha256',codeKey).update(`code:${id}`).digest();
  return String(digest.readUInt32BE(0)%1_000_000).padStart(6,'0');
}
export function codeHash(candidateId:string,code:string):string{return createHmac('sha256',codeKey).update(`verify:${candidateId}:${code}`).digest('hex');}
export function limitHash(kind:'email'|'ip',value:string):string{return createHmac('sha256',codeKey).update(`${kind}:${value}`).digest('hex');}
export const generalCodeMessage='Bu adres için uygun bir kayıt varsa doğrulama kodu gönderilecektir.';

type Message={to:string;subject:string;text:string;html:string};
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const trDate=(value:Date)=>new Intl.DateTimeFormat('tr-TR',{dateStyle:'long',timeStyle:'short',timeZone:'Europe/Istanbul'}).format(value)+' (Europe/İstanbul)';
async function transport(message:Message):Promise<void>{
  if(mailMode==='test'){
    if(process.env.MAIL_TEST_FAIL==='before_accept') throw new MailFailure('rejected');
    return;
  }
  if(mailMode!=='smtp') throw new MailFailure('configuration');
  const client=nodemailer.createTransport({host:process.env.SMTP_HOST!,port:smtpPort,secure:smtpPort===465,requireTLS:smtpPort!==465,auth:{user:process.env.SMTP_USER!,pass:process.env.SMTP_PASSWORD!},connectionTimeout:12000,greetingTimeout:10000,socketTimeout:15000});
  const result=await client.sendMail({from,to:message.to,subject:message.subject,text:message.text,html:message.html});
  if(!result.accepted?.some(address=>address.toLowerCase()===message.to.toLowerCase())) throw new MailFailure('rejected');
}
export async function verifySmtpConnection():Promise<void>{
  if(mailMode!=='smtp')throw new Error('MAIL_MODE=smtp ayarlanmalı.');
  const client=nodemailer.createTransport({host:process.env.SMTP_HOST!,port:smtpPort,secure:smtpPort===465,requireTLS:smtpPort!==465,auth:{user:process.env.SMTP_USER!,pass:process.env.SMTP_PASSWORD!},connectionTimeout:12000,greetingTimeout:10000,socketTimeout:15000});
  await client.verify();
}
class MailFailure extends Error{constructor(public kind:'rejected'|'configuration'){super(kind);}}
type Job={id:string;kind:'login_code'|'invitation';login_code_id:string|null;invitation_id:string|null};
async function messageFor(job:Job):Promise<Message|null>{
  if(job.kind==='login_code'){
    const {rows}=await pool.query<{id:string;email:string;expires_at:Date;consumed_at:Date|null}>(`SELECT lc.id,c.email,lc.expires_at,lc.consumed_at FROM login_codes lc JOIN candidates c ON c.id=lc.candidate_id WHERE lc.id=$1`,[job.login_code_id]);
    const row=rows[0];if(!row||row.consumed_at||new Date(row.expires_at).getTime()<=Date.now())return null;
    const code=codeForId(row.id);
    return {to:row.email,subject:'Mülakat platformu giriş kodu',text:`Giriş kodunuz: ${code}\n\nKod 10 dakika geçerlidir ve yalnız bir kez kullanılabilir. Bu isteği siz yapmadıysanız bu iletiyi dikkate almayın.`,html:`<div style="font-family:Arial,sans-serif;color:#172b50;max-width:560px"><h1 style="font-size:22px">Giriş kodunuz</h1><p>Mülakat platformuna giriş için kodunuz:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>Kod 10 dakika geçerlidir ve yalnız bir kez kullanılabilir.</p><p>Bu isteği siz yapmadıysanız bu iletiyi dikkate almayın.</p></div>`};
  }
  const {rows}=await pool.query<{id:string;status:string;expires_at:Date;estimated_minutes:number;email:string;organization_name:string;position_title:string;position_status:string}>(`SELECT i.id,i.status,i.expires_at,i.estimated_minutes,c.email,o.name AS organization_name,pv.title AS position_title,p.status AS position_status
    FROM invitations i JOIN applications a ON a.id=i.application_id AND a.organization_id=i.organization_id JOIN candidates c ON c.id=a.candidate_id JOIN organizations o ON o.id=i.organization_id JOIN positions p ON p.id=i.position_id AND p.organization_id=i.organization_id JOIN position_versions pv ON pv.position_id=i.position_id AND pv.version_no=i.position_version WHERE i.id=$1`,[job.invitation_id]);
  const row=rows[0];if(!row||row.status!=='prepared'||row.position_status!=='active'||new Date(row.expires_at).getTime()<=Date.now())return null;
  const base=publicInvitationBase();if(!base)throw new MailFailure('configuration');
  const link=`${base}/aday/davet/${invitationToken(row.id)}`,deadline=trDate(new Date(row.expires_at));
  const text=`${row.organization_name} tarafından mülakat daveti\n\nPozisyon: ${row.position_title}\nTahmini süre: ${row.estimated_minutes} dakika\nSon katılım: ${deadline}\nKişisel bağlantı: ${link}\n\nBağlantıyı açtıktan sonra davetin gönderildiği e-posta adresinize gelen kodla giriş yapmanız gerekir. Bağlantıyı paylaşmayın.`;
  const html=`<div style="font-family:Arial,sans-serif;color:#172b50;max-width:600px"><h1 style="font-size:22px">Mülakat daveti</h1><p><strong>${escapeHtml(row.organization_name)}</strong> sizi mülakata davet ediyor.</p><p><strong>Pozisyon:</strong> ${escapeHtml(row.position_title)}<br><strong>Tahmini süre:</strong> ${row.estimated_minutes} dakika<br><strong>Son katılım:</strong> ${escapeHtml(deadline)}</p><p><a href="${escapeHtml(link)}" style="background:#172b50;color:#fff;padding:12px 18px;text-decoration:none;border-radius:5px">Daveti görüntüle</a></p><p>Bağlantıyı açtıktan sonra bu e-posta adresinize gelen kodla giriş yapmanız gerekir. Bağlantıyı paylaşmayın.</p></div>`;
  return {to:row.email,subject:'Mülakat daveti',text,html};
}
let running=false;
export async function processEmailJobs():Promise<void>{
  if(running||mailMode==='disabled')return;
  running=true;
  try{
    await pool.query("UPDATE email_jobs SET status='uncertain',failure_kind='interrupted' WHERE status='sending' AND started_at<now()-interval '2 minutes'");
    await pool.query("UPDATE invitations i SET delivery_status='uncertain' FROM email_jobs j WHERE j.invitation_id=i.id AND j.status='uncertain' AND i.delivery_status='sending'");
    for(let n=0;n<10;n++){
      const job=await transaction(async client=>{
        const row=(await client.query<Job>("SELECT id,kind,login_code_id,invitation_id FROM email_jobs WHERE status='pending' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
        if(!row)return null;
        await client.query("UPDATE email_jobs SET status='sending',started_at=now(),attempt_count=attempt_count+1,failure_kind=NULL WHERE id=$1",[row.id]);
        if(row.invitation_id)await client.query("UPDATE invitations SET delivery_status='sending' WHERE id=$1",[row.invitation_id]);
        return row;
      });
      if(!job)break;
      let status:'accepted'|'failed'|'uncertain'='accepted',failureKind:string|null=null;
      try{const message=await messageFor(job);if(!message){status='failed';failureKind='inactive';}else await transport(message);}
      catch(error){
        if(error instanceof MailFailure){status='failed';failureKind=error.kind;}
        else{const details=error as {code?:string;syscall?:string};status=['EAUTH','ENOAUTH','ECONFIG','EDNS','ECONNECTION','ETLS'].includes(details?.code||'')||(details?.code==='ESOCKET'&&details?.syscall==='connect')?'failed':'uncertain';failureKind=status==='failed'?'smtp_setup':'delivery_unknown';}
      }
      await transaction(async client=>{
        await client.query("UPDATE email_jobs SET status=$2,failure_kind=$3,accepted_at=CASE WHEN $2='accepted' THEN now() ELSE accepted_at END,failed_at=CASE WHEN $2='failed' THEN now() ELSE failed_at END WHERE id=$1",[job.id,status,failureKind]);
        if(job.invitation_id)await client.query('UPDATE invitations SET delivery_status=$2 WHERE id=$1',[job.invitation_id,status]);
      });
    }
  }finally{running=false;}
}
export function startEmailWorker():void{void processEmailJobs().catch(()=>console.error('E-posta işi işlenemedi.'));const timer=setInterval(()=>{void processEmailJobs().catch(()=>console.error('E-posta işi işlenemedi.'));},2000);timer.unref();}
