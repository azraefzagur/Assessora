import type {Express,NextFunction,Request,RequestHandler,Response} from 'express';
import multer from 'multer';
import {pool,transaction} from './db.ts';
import {newId} from './security.ts';
import {invitationHash,invitationToken,idFromInvitationToken} from './invitation.ts';
import {mailMode,processEmailJobs,publicInvitationBase} from './email.ts';
import {HttpError,ValidationError,parseApplication,parseInvitation,parsePosition,uuidPattern} from './validation.ts';
import type {Membership,RequirementInput} from './types.ts';

const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5_000_000,files:1},fileFilter:(_req,file,done)=>{
  if(file.mimetype!=='application/pdf'||!file.originalname.toLowerCase().endsWith('.pdf')) return done(new ValidationError('Yalnız PDF dosyası yüklenebilir.'));
  done(null,true);
}}).single('file');
const route=(handler:(req:Request,res:Response)=>Promise<unknown>):RequestHandler=>(req,res,next)=>{Promise.resolve(handler(req,res)).catch(next);};
const invitationState=(row:{status:string;expires_at:Date})=>row.status==='prepared'&&new Date(row.expires_at).getTime()<=Date.now()?'expired':row.status;
const devPath=(id:string)=>mailMode==='test'?`/aday/davet/${invitationToken(id)}`:null;

export function registerStage2(app:Express,company:(roles?:Membership['role'][])=>RequestHandler,candidate:RequestHandler):void{
  app.put('/api/company/positions/:id',company(['admin','recruiter']),route(async(req,res)=>{
    const id=req.params.id,status=req.body?.status;
    if(typeof id!=='string'||!uuidPattern.test(id)) throw new HttpError(404,'Pozisyon bulunamadı.');
    if(!['draft','active','closed'].includes(status)) throw new ValidationError('Pozisyon durumu geçersiz.');
    const input=parsePosition(req.body),org=req.session.organization_id!;
    const result=await transaction(async client=>{
      const current=(await client.query<{title:string;description:string;status:string;current_version:number}>('SELECT title,description,status,current_version FROM positions WHERE id=$1 AND organization_id=$2 FOR UPDATE',[id,org])).rows[0];
      if(!current) throw new HttpError(404,'Pozisyon bulunamadı.');
      if(current.status==='active'&&status==='draft') throw new ValidationError('Aktif pozisyon yeniden taslağa çevrilemez.');
      if(current.status==='closed'&&status==='draft') throw new ValidationError('Kapalı pozisyon yeniden taslağa çevrilemez.');
      const previous=(await client.query<RequirementInput>('SELECT label,weight,required FROM position_requirements WHERE position_id=$1 AND organization_id=$2 AND version_no=$3 ORDER BY sort_order',[id,org,current.current_version])).rows;
      const changed=current.title!==input.title||current.description!==input.description||JSON.stringify(previous)!==JSON.stringify(input.requirements);
      const version=current.current_version+(changed?1:0);
      if(changed){
        await client.query('INSERT INTO position_versions (position_id,organization_id,version_no,title,description,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6)',[id,org,version,input.title,input.description,req.session.actor_id]);
        for(const [i,r] of input.requirements.entries()) await client.query('INSERT INTO position_requirements (id,organization_id,position_id,version_no,label,required,weight,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[newId(),org,id,version,r.label,r.required,r.weight,i]);
      }
      await client.query('UPDATE positions SET title=$3,description=$4,status=$5,current_version=$6 WHERE id=$1 AND organization_id=$2',[id,org,input.title,input.description,status,version]);
      if(status==='closed'&&current.status!=='closed') await client.query("UPDATE invitations SET status='cancelled',cancelled_at=now() WHERE position_id=$1 AND organization_id=$2 AND status='prepared'",[id,org]);
      return {id,status,version};
    });
    res.json(result);
  }));

  app.get('/api/company/applications',company(),route(async(req,res)=>{
    const positionId=typeof req.query.positionId==='string'?req.query.positionId:null;
    if(positionId&&!uuidPattern.test(positionId)) throw new ValidationError('Pozisyon kimliği geçersiz.');
    const {rows}=await pool.query(`SELECT a.id,a.candidate_name,c.email,p.title AS position_title,p.id AS position_id,a.status,a.created_at,
      cv.id IS NOT NULL AS has_cv,
      cva.match_status, cva.summary AS cv_summary,
      EXISTS (SELECT 1 FROM invitations i WHERE i.application_id=a.id AND i.status='prepared' AND i.expires_at>now()) AS has_open_invitation
      FROM applications a JOIN candidates c ON c.id=a.candidate_id JOIN positions p ON p.id=a.position_id AND p.organization_id=a.organization_id
      LEFT JOIN cv_documents cv ON cv.application_id=a.id AND cv.organization_id=a.organization_id
      LEFT JOIN cv_analyses cva ON cva.application_id=a.id
      WHERE a.organization_id=$1 AND ($2::uuid IS NULL OR a.position_id=$2) ORDER BY a.created_at DESC`,[req.session.organization_id,positionId]);
    res.json({applications:rows,role:req.membership?.role});
  }));
  app.post('/api/company/applications',company(['admin','recruiter']),route(async(req,res)=>{
    const input=parseApplication(req.body),org=req.session.organization_id!;
    const id=await transaction(async client=>{
      const position=(await client.query<{id:string;status:string;current_version:number}>('SELECT id,status,current_version FROM positions WHERE id=$1 AND organization_id=$2',[input.positionId,org])).rows[0];
      if(!position) throw new HttpError(404,'Pozisyon bulunamadı.');
      if(position.status==='closed') throw new ValidationError('Kapalı pozisyona başvuru eklenemez.');
      await client.query('INSERT INTO candidates (id,email,full_name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',[newId(),input.email,input.fullName]);
      const person=(await client.query<{id:string}>('SELECT id FROM candidates WHERE lower(email)=$1',[input.email])).rows[0];
      const applicationId=newId();
      const inserted=await client.query('INSERT INTO applications (id,organization_id,position_id,position_version,candidate_id,candidate_name) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (position_id,candidate_id) DO NOTHING RETURNING id',[applicationId,org,position.id,position.current_version,person.id,input.fullName]);
      if(!inserted.rowCount) throw new HttpError(409,'Bu adayın bu pozisyonda zaten başvurusu var.');
      return applicationId;
    });
    res.status(201).json({id});
  }));
  app.get('/api/company/applications/:id',company(),route(async(req,res)=>{
    const id=req.params.id;if(typeof id!=='string'||!uuidPattern.test(id)) throw new HttpError(404,'Başvuru bulunamadı.');
    const {rows}=await pool.query(`SELECT a.id,a.candidate_name,c.email,a.status,a.created_at,a.position_version,p.id AS position_id,p.title AS position_title,p.status AS position_status,
      cv.id AS cv_id,cv.original_filename AS cv_name,cv.size_bytes AS cv_size,cv.review_status AS cv_review_status,
      i.id AS invitation_id,i.status AS invitation_status,i.delivery_status,i.estimated_minutes,i.expires_at
      FROM applications a JOIN candidates c ON c.id=a.candidate_id JOIN positions p ON p.id=a.position_id AND p.organization_id=a.organization_id
      LEFT JOIN cv_documents cv ON cv.application_id=a.id AND cv.organization_id=a.organization_id
      LEFT JOIN LATERAL (SELECT * FROM invitations WHERE application_id=a.id AND organization_id=a.organization_id ORDER BY created_at DESC LIMIT 1) i ON true
      WHERE a.id=$1 AND a.organization_id=$2`,[id,req.session.organization_id]);
    if(!rows[0]) throw new HttpError(404,'Başvuru bulunamadı.');
    const row=rows[0];
    res.json({...row,invitation_status:row.invitation_id?invitationState({status:row.invitation_status,expires_at:row.expires_at}):null,test_link:row.invitation_id&&row.invitation_status==='prepared'&&new Date(row.expires_at).getTime()>Date.now()?devPath(row.invitation_id):null,mail_mode:mailMode,role:req.membership?.role});
  }));
  app.post('/api/company/applications/:id/cv',company(['admin','recruiter']),upload,route(async(req,res)=>{
    const id=req.params.id,file=req.file;
    if(typeof id!=='string'||!uuidPattern.test(id)) throw new HttpError(404,'Başvuru bulunamadı.');
    if(!file) throw new ValidationError('PDF dosyası seçin.');
    if(file.buffer.length<8||file.buffer.subarray(0,5).toString('ascii')!=='%PDF-') throw new ValidationError('Dosya geçerli bir PDF başlığı taşımıyor.');
    const org=req.session.organization_id!;
    const application=(await pool.query('SELECT id FROM applications WHERE id=$1 AND organization_id=$2',[id,org])).rows[0];
    if(!application) throw new HttpError(404,'Başvuru bulunamadı.');
    const inserted=await pool.query(`INSERT INTO cv_documents (id,organization_id,application_id,original_filename,media_type,size_bytes,content,uploaded_by_user_id)
      VALUES ($1,$2,$3,$4,'application/pdf',$5,$6,$7) ON CONFLICT (application_id) DO NOTHING RETURNING id`,[newId(),org,id,file.originalname.slice(0,255),file.buffer.length,file.buffer,req.session.actor_id]);
    if(!inserted.rows[0]) throw new HttpError(409,'Bu başvuruya CV yüklenmiş. Yeni dosya eklemek için ayrı bir sürüm akışı gerekir.');
    res.status(201).json({id:inserted.rows[0].id,status:'review_pending'});
  }));
  app.get('/api/company/applications/:id/cv',company(),route(async(req,res)=>{
    const id=req.params.id;if(typeof id!=='string'||!uuidPattern.test(id)) throw new HttpError(404,'CV bulunamadı.');
    const {rows}=await pool.query<{content:Buffer}>('SELECT cv.content FROM cv_documents cv JOIN applications a ON a.id=cv.application_id AND a.organization_id=cv.organization_id WHERE a.id=$1 AND a.organization_id=$2',[id,req.session.organization_id]);
    if(!rows[0]) throw new HttpError(404,'CV bulunamadı.');
    res.type('application/pdf').set('Content-Disposition','inline; filename="CV.pdf"').set('Cache-Control','no-store').send(rows[0].content);
  }));

  app.post('/api/company/applications/:id/invitations',company(['admin','recruiter']),route(async(req,res)=>{
    const id=req.params.id;if(typeof id!=='string'||!uuidPattern.test(id)) throw new HttpError(404,'Başvuru bulunamadı.');
    const input=parseInvitation(req.body),org=req.session.organization_id!;
    const invite=await transaction(async client=>{
      const appRow=(await client.query<{position_id:string;status:string;current_version:number}>(`SELECT p.id AS position_id,p.status,p.current_version FROM applications a JOIN positions p ON p.id=a.position_id AND p.organization_id=a.organization_id WHERE a.id=$1 AND a.organization_id=$2 FOR UPDATE OF a`,[id,org])).rows[0];
      if(!appRow) throw new HttpError(404,'Başvuru bulunamadı.');
      if(appRow.status!=='active') throw new ValidationError('Davet için pozisyon aktif olmalı.');
      await client.query("UPDATE invitations SET status='expired' WHERE application_id=$1 AND status='prepared' AND expires_at<=now()",[id]);
      const open=await client.query("SELECT 1 FROM invitations WHERE application_id=$1 AND status='prepared'",[id]);
      if(open.rowCount) throw new HttpError(409,'Bu başvurunun açık daveti var. Önce iptal edin.');
      const invitationId=newId();
      await client.query(`INSERT INTO invitations (id,organization_id,application_id,position_id,position_version,token_hash,estimated_minutes,expires_at,created_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[invitationId,org,id,appRow.position_id,appRow.current_version,invitationHash(invitationId),input.estimatedMinutes,input.expiresAt,req.session.actor_id]);
      return {id:invitationId,status:'prepared',delivery_status:'not_sent',test_link:devPath(invitationId)};
    });
    res.status(201).json(invite);
  }));
  app.post('/api/company/invitations/:id/cancel',company(['admin','recruiter']),route(async(req,res)=>{
    const id=req.params.id;if(typeof id!=='string'||!uuidPattern.test(id)) throw new HttpError(404,'Davet bulunamadı.');
    const found=await transaction(async client=>{
      const {rows}=await client.query("UPDATE invitations SET status='cancelled',cancelled_at=now() WHERE id=$1 AND organization_id=$2 AND status='prepared' RETURNING id",[id,req.session.organization_id]);
      if(rows[0])await client.query("UPDATE email_jobs SET status='failed',failure_kind='inactive',failed_at=now() WHERE invitation_id=$1 AND status='pending'",[id]);
      return rows[0];
    });
    if(!found) throw new HttpError(404,'Açık davet bulunamadı.');
    res.json({id,status:'cancelled'});
  }));
  app.post('/api/company/invitations/:id/send',company(['admin','recruiter']),route(async(req,res)=>{
    const id=req.params.id;if(typeof id!=='string'||!uuidPattern.test(id)) throw new HttpError(404,'Davet bulunamadı.');
    if(mailMode==='disabled') throw new HttpError(503,'E-posta gönderimi yapılandırılmadı.');
    if(!publicInvitationBase()) throw new HttpError(503,'Davet bağlantısı için APP_PUBLIC_URL ayarlayın. Gerçek gönderimde dışarıdan erişilebilen HTTPS adresi gereklidir.');
    const status=await transaction(async client=>{
      const invitation=(await client.query<{status:string;expires_at:Date;position_status:string}>(`SELECT i.status,i.expires_at,p.status AS position_status FROM invitations i JOIN positions p ON p.id=i.position_id AND p.organization_id=i.organization_id WHERE i.id=$1 AND i.organization_id=$2 FOR UPDATE OF i`,[id,req.session.organization_id])).rows[0];
      if(!invitation) throw new HttpError(404,'Davet bulunamadı.');
      if(invitation.status!=='prepared'||new Date(invitation.expires_at).getTime()<=Date.now()||invitation.position_status!=='active') throw new HttpError(409,'İptal edilmiş, süresi dolmuş veya kapalı pozisyon daveti gönderilemez.');
      const job=(await client.query<{id:string;status:string}>('SELECT id,status FROM email_jobs WHERE invitation_id=$1 FOR UPDATE',[id])).rows[0];
      if(job&&job.status!=='failed')return job.status;
      if(job)await client.query("UPDATE email_jobs SET status='pending',failure_kind=NULL,failed_at=NULL WHERE id=$1",[job.id]);
      else await client.query("INSERT INTO email_jobs (id,kind,invitation_id) VALUES ($1,'invitation',$2)",[newId(),id]);
      await client.query("UPDATE invitations SET delivery_status='pending' WHERE id=$1",[id]);
      return 'pending';
    });
    void processEmailJobs().catch(()=>console.error('E-posta işi işlenemedi.'));
    res.status(status==='pending'?202:200).json({delivery_status:status});
  }));
  app.get('/api/company/invitations/:id',company(),route(async(req,res)=>{
    const id=req.params.id;if(typeof id!=='string'||!uuidPattern.test(id)) throw new HttpError(404,'Davet bulunamadı.');
    const {rows}=await pool.query(`SELECT i.id,i.status,i.delivery_status,i.estimated_minutes,i.expires_at,i.created_at,i.position_version,
      a.id AS application_id,a.candidate_name,c.email,p.title AS position_title,o.name AS organization_name
      FROM invitations i JOIN applications a ON a.id=i.application_id AND a.organization_id=i.organization_id JOIN candidates c ON c.id=a.candidate_id
      JOIN positions p ON p.id=i.position_id AND p.organization_id=i.organization_id JOIN organizations o ON o.id=i.organization_id
      WHERE i.id=$1 AND i.organization_id=$2`,[id,req.session.organization_id]);
    if(!rows[0]) throw new HttpError(404,'Davet bulunamadı.');
    const item=rows[0];
    const job=(await pool.query<{status:string;failure_kind:string|null}>('SELECT status,failure_kind FROM email_jobs WHERE invitation_id=$1',[id])).rows[0];
    const base=publicInvitationBase();
    res.json({...item,status:invitationState(item),delivery_status:job?.status||item.delivery_status,delivery_failure:job?.failure_kind||null,preview_link:base?`${base}/aday/davet/${invitationToken(item.id)}`:null,test_link:item.status==='prepared'&&new Date(item.expires_at).getTime()>Date.now()?devPath(item.id):null,mail_mode:mailMode});
  }));

  app.get('/api/candidate/invitations',candidate,route(async(req,res)=>{
    const {rows}=await pool.query(`SELECT i.id,i.estimated_minutes,i.expires_at,i.position_version,a.id AS application_id,p.title AS position_title,o.name AS organization_name,
      s.status AS session_status, s.current_step, s.current_question_index
      FROM invitations i JOIN applications a ON a.id=i.application_id AND a.organization_id=i.organization_id
      JOIN positions p ON p.id=i.position_id AND p.organization_id=i.organization_id JOIN organizations o ON o.id=i.organization_id
      LEFT JOIN interview_sessions s ON s.application_id=a.id
      WHERE a.candidate_id=$1 AND i.status='prepared' AND i.expires_at>now() ORDER BY i.created_at DESC`,[req.session.actor_id]);
    res.json({invitations:rows.map(row=>({...row,path:`/aday/davet/${invitationToken(row.id)}`}))});
  }));
  app.get('/api/candidate/applications/:id',candidate,route(async(req,res)=>{
    const id=req.params.id;if(typeof id!=='string'||!uuidPattern.test(id)) throw new HttpError(404,'Başvuru bulunamadı.');
    const {rows}=await pool.query(`SELECT a.id,a.status,a.created_at,a.position_version,a.candidate_name,p.title AS position_title,o.name AS organization_name,
      cv.id IS NOT NULL AS has_cv,i.id AS invitation_id,i.estimated_minutes,i.expires_at,
      row_to_json(ap.*) AS appeal
      FROM applications a JOIN positions p ON p.id=a.position_id AND p.organization_id=a.organization_id JOIN organizations o ON o.id=a.organization_id
      LEFT JOIN cv_documents cv ON cv.application_id=a.id AND cv.organization_id=a.organization_id
      LEFT JOIN LATERAL (SELECT * FROM invitations WHERE application_id=a.id AND status='prepared' AND expires_at>now() ORDER BY created_at DESC LIMIT 1) i ON true
      LEFT JOIN LATERAL (SELECT id, status, reason, timestamp_reference, reviewer_notes, created_at FROM appeals WHERE application_id=a.id ORDER BY created_at DESC LIMIT 1) ap ON true
      WHERE a.id=$1 AND a.candidate_id=$2`,[id,req.session.actor_id]);
    if(!rows[0]) throw new HttpError(404,'Başvuru bulunamadı.');
    const item=rows[0];res.json({...item,invitation_path:item.invitation_id?`/aday/davet/${invitationToken(item.invitation_id)}`:null});
  }));
  app.get('/api/candidate/invitations/:token',candidate,route(async(req,res)=>{
    const token=req.params.token,id=typeof token==='string'?idFromInvitationToken(token):null;
    if(!id) throw new HttpError(404,'Davet bulunamadı.');
    const {rows}=await pool.query(`SELECT i.id,i.status,i.delivery_status,i.estimated_minutes,i.expires_at,i.position_version,a.id AS application_id,
      p.title AS position_title,o.name AS organization_name
      FROM invitations i JOIN applications a ON a.id=i.application_id AND a.organization_id=i.organization_id
      JOIN positions p ON p.id=i.position_id AND p.organization_id=i.organization_id JOIN organizations o ON o.id=i.organization_id
      WHERE i.id=$1 AND i.token_hash=$2 AND a.candidate_id=$3`,[id,invitationHash(id),req.session.actor_id]);
    if(!rows[0]) throw new HttpError(404,'Davet bulunamadı.');
    if(invitationState(rows[0])!=='prepared') throw new HttpError(410,'Bu davet iptal edildi veya süresi doldu.');
    res.json({...rows[0],mail_mode:mailMode});
  }));
}
