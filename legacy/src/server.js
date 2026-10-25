import express from 'express';
import { randomInt } from 'node:crypto';
import { db } from './db.js';
import { newId, hashToken, verifyPassword, newSession, sessionFromToken, cookie, csrfValid } from './security.js';
import { page, escape, csrfField, errorBox } from './views.js';
import './migrate.js';

if (process.env.NODE_ENV !== 'development') throw new Error('Eski SQLite uygulaması yalnız geliştirme ortamında çalıştırılabilir.');

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: false, limit: '30kb' }));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  const token = /(?:^|; )assessora_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  let session = sessionFromToken(token);
  if (!session) {
    const fresh = newSession();
    res.setHeader('Set-Cookie', cookie(fresh.token));
    session = sessionFromToken(fresh.token);
  }
  req.session = session;
  req.sessionToken = token;
  next();
});
app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  if (!csrfValid(req.body?._csrf, req.session.csrf_token)) return res.status(403).send('Geçersiz istek. Sayfayı yenileyip tekrar deneyin.');
  next();
});
const render = (req, res, title, body, extra = {}) => res.send(page({ title, body, session:req.session, csrf:req.session.csrf_token, ...extra }));
const swapSession = (req, res, type, id, orgId = null) => {
  db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(req.session.id_hash);
  const fresh = newSession(type, id, orgId);
  res.setHeader('Set-Cookie', cookie(fresh.token));
};
const requireCompany = (roles = ['admin','recruiter','reviewer']) => (req, res, next) => {
  if (req.session.actor_type !== 'company') return res.redirect('/sirket/giris');
  const membership = db.prepare(`SELECT m.role,o.name FROM memberships m JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=? AND m.organization_id=? AND m.active=1`).get(req.session.actor_id, req.session.organization_id);
  if (!membership || !roles.includes(membership.role)) return res.status(403).send('Bu işlem için yetkiniz yok.');
  req.membership = membership;
  next();
};
const requireCandidate = (req, res, next) => req.session.actor_type === 'candidate' ? next() : res.redirect('/aday/giris');

app.get('/', (req, res) => res.redirect(req.session.actor_type === 'company' ? '/sirket' : req.session.actor_type === 'candidate' ? '/aday' : '/sirket/giris'));
function authPage(req, res, kind, message = '', status = 200) {
  const company = kind === 'company';
  res.status(status);
  render(req, res, company ? 'Şirket girişi' : 'Aday girişi', `<div class="auth-page"><section class="auth-intro"><div class="brand"><small>İşe alım platformu</small>Mülakat</div><h1>${company?'İşe alım sürecinizi tek yerde yönetin.':'Başvurularınızı güvenle takip edin.'}</h1><p>${company?'Pozisyonlarınızı ve aday sürecinizi yetkili ekibinizle yönetin.':'Davet edildiğiniz e-posta adresine gönderilen kodla giriş yapın.'}</p></section><section class="auth-panel"><div class="auth-box"><div class="card"><h2>${company?'Şirket hesabı':'Aday girişi'}</h2><p class="muted">${company?'Kurumsal e-postanız ve şifrenizle devam edin.':'E-posta adresinizi doğrulayarak başvurularınıza erişin.'}</p>${errorBox(message)}<form method="post" action="${company?'/sirket/giris':'/aday/kod-iste'}">${csrfField(req.session.csrf_token)}<div class="field"><label for="email">E-posta adresi</label><input id="email" name="email" type="email" autocomplete="email" required></div>${company?'<div class="field"><label for="password">Şifre</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>':''}<button class="button" type="submit">${company?'Giriş yap':'Kod gönder'}</button></form></div><div class="auth-links">${company?'<a href="/aday/giris">Aday girişi →</a>':'<a href="/sirket/giris">← Şirket girişi</a>'}</div></div></section></div>`);
}
app.get('/sirket/giris', (req,res) => authPage(req,res,'company'));
app.post('/sirket/giris', (req,res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const membership = user && db.prepare('SELECT * FROM memberships WHERE user_id=? AND active=1 ORDER BY rowid LIMIT 1').get(user.id);
  if (!user || !membership || !verifyPassword(password,user.password_hash)) return authPage(req,res,'company','E-posta veya şifre hatalı.',401);
  swapSession(req,res,'company',user.id,membership.organization_id);
  res.redirect('/sirket');
});
app.post('/cikis', (req,res) => {
  db.prepare('DELETE FROM sessions WHERE id_hash=?').run(req.session.id_hash);
  const fresh = newSession();
  res.setHeader('Set-Cookie',cookie(fresh.token));
  res.redirect('/');
});
app.get('/sirket', requireCompany(), (req,res) => {
  const org = req.session.organization_id;
  const positions = db.prepare('SELECT COUNT(*) AS n FROM positions WHERE organization_id=?').get(org).n;
  const applications = db.prepare('SELECT COUNT(*) AS n FROM applications WHERE organization_id=?').get(org).n;
  const recent = db.prepare('SELECT id,title,status,created_at FROM positions WHERE organization_id=? ORDER BY created_at DESC LIMIT 5').all(org);
  render(req,res,'Genel bakış',`<div class="heading"><div><h1>Genel bakış</h1><p class="muted">${escape(req.membership.name)} için işe alım çalışma alanı.</p></div><a class="button" href="/sirket/pozisyonlar/yeni">Yeni pozisyon</a></div><div class="grid"><div class="card"><div class="label">Pozisyonlar</div><div class="metric">${positions}</div></div><div class="card"><div class="label">Başvurular</div><div class="metric">${applications}</div></div><div class="card"><div class="label">Rolünüz</div><div class="metric" style="font-size:22px">${({admin:'Yönetici',recruiter:'İşe alım',reviewer:'Değerlendirici'})[req.membership.role]}</div></div></div><div class="card" style="margin-top:24px"><h2>Son pozisyonlar</h2>${recent.length?`<div class="table-wrap"><table><thead><tr><th>Başlık</th><th>Durum</th><th>Oluşturulma</th></tr></thead><tbody>${recent.map(p=>`<tr><td><a href="/sirket/pozisyonlar/${escape(p.id)}">${escape(p.title)}</a></td><td><span class="badge">${p.status==='draft'?'Taslak':escape(p.status)}</span></td><td>${escape(p.created_at)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Henüz pozisyon oluşturulmadı.</div>'}</div>`,{companyName:req.membership.name,active:'home'});
});
app.get('/sirket/pozisyonlar', requireCompany(), (req,res) => {
  const rows = db.prepare('SELECT p.id,p.title,p.status,p.created_at,COUNT(a.id) AS applicant_count FROM positions p LEFT JOIN applications a ON a.position_id=p.id AND a.organization_id=p.organization_id WHERE p.organization_id=? GROUP BY p.id ORDER BY p.created_at DESC').all(req.session.organization_id);
  render(req,res,'Pozisyonlar',`<div class="heading"><div><h1>Pozisyonlar</h1><p class="muted">Şirketinizin açık ve taslak pozisyonları.</p></div>${req.membership.role!=='reviewer'?'<a class="button" href="/sirket/pozisyonlar/yeni">Yeni pozisyon</a>':''}</div><div class="card">${rows.length?`<div class="table-wrap"><table><thead><tr><th>Pozisyon</th><th>Durum</th><th>Başvuru</th><th>Oluşturulma</th></tr></thead><tbody>${rows.map(p=>`<tr><td><a href="/sirket/pozisyonlar/${escape(p.id)}">${escape(p.title)}</a></td><td><span class="badge">${p.status==='draft'?'Taslak':escape(p.status)}</span></td><td>${p.applicant_count}</td><td>${escape(p.created_at)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Henüz pozisyon yok.</div>'}</div>`,{companyName:req.membership.name,active:'positions'});
});
function positionForm(req,res,message='',status=200) {
  res.status(status);
  render(req,res,'Yeni pozisyon',`<div class="heading"><div><h1>Yeni pozisyon</h1><p class="muted">İş tanımı ve değerlendirme gereksinimlerini kaydedin.</p></div></div><div class="card" style="max-width:800px">${errorBox(message)}<form method="post" action="/sirket/pozisyonlar">${csrfField(req.session.csrf_token)}<div class="field"><label for="title">Pozisyon başlığı</label><input id="title" name="title" maxlength="160" minlength="3" required value="${escape(req.body?.title||'')}"></div><div class="field"><label for="description">İş tanımı</label><textarea id="description" name="description" maxlength="10000" minlength="10" required>${escape(req.body?.description||'')}</textarea></div><h2>Yetkinlikler ve ağırlıklar</h2><p class="muted">En az bir yetkinlik girin. Dolu satırların ağırlıkları toplamı %100 olmalıdır.</p>${[0,1,2,3,4].map(i=>`<div class="req-row"><input aria-label="${i+1}. yetkinlik" name="label${i}" maxlength="120" placeholder="Yetkinlik" value="${escape(req.body?.[`label${i}`]||'')}"><input aria-label="${i+1}. ağırlık" name="weight${i}" type="number" min="0" max="100" placeholder="%" value="${escape(req.body?.[`weight${i}`]||'')}"><label style="font-weight:400;margin:0;align-self:center"><input name="required${i}" type="checkbox" value="1" ${req.body?.[`required${i}`]?'checked':''}> Zorunlu</label></div>`).join('')}<div style="margin-top:24px"><button class="button" type="submit">Taslak oluştur</button> <a class="button secondary" href="/sirket/pozisyonlar">Vazgeç</a></div></form></div>`,{companyName:req.membership.name,active:'positions'});
}
app.get('/sirket/pozisyonlar/yeni',requireCompany(['admin','recruiter']),(req,res)=>positionForm(req,res));
app.post('/sirket/pozisyonlar',requireCompany(['admin','recruiter']),(req,res)=>{
  const title=String(req.body.title||'').trim();
  const description=String(req.body.description||'').trim();
  const requirements=[];
  for(let i=0;i<5;i++){
    const label=String(req.body[`label${i}`]||'').trim();
    const raw=String(req.body[`weight${i}`]||'').trim();
    if(!label && !raw) continue;
    const weight=Number(raw);
    if(!label || label.length>120 || raw==='' || !Number.isInteger(weight) || weight<0 || weight>100) return positionForm(req,res,'Yetkinlik ve ağırlık alanlarını kontrol edin.',400);
    requirements.push({label,weight,required:req.body[`required${i}`]==='1'?1:0});
  }
  if(title.length<3 || title.length>160 || description.length<10 || description.length>10000 || !requirements.length || requirements.reduce((n,r)=>n+r.weight,0)!==100) return positionForm(req,res,'Başlık, iş tanımı ve toplamı %100 olan yetkinlikler gereklidir.',400);
  const id=newId(), org=req.session.organization_id;
  db.transaction(()=>{
    db.prepare('INSERT INTO positions (id,organization_id,title,description,created_by_user_id) VALUES (?,?,?,?,?)').run(id,org,title,description,req.session.actor_id);
    const insert=db.prepare('INSERT INTO position_requirements (id,organization_id,position_id,label,required,weight,sort_order) VALUES (?,?,?,?,?,?,?)');
    requirements.forEach((r,i)=>insert.run(newId(),org,id,r.label,r.required,r.weight,i));
  })();
  res.redirect(`/sirket/pozisyonlar/${id}`);
});
app.get('/sirket/pozisyonlar/:id',requireCompany(),(req,res)=>{
  const org=req.session.organization_id;
  const p=db.prepare('SELECT * FROM positions WHERE id=? AND organization_id=?').get(req.params.id,org);
  if(!p) return res.status(404).send('Pozisyon bulunamadı.');
  const requirements=db.prepare('SELECT * FROM position_requirements WHERE position_id=? AND organization_id=? ORDER BY sort_order').all(p.id,org);
  render(req,res,p.title,`<div class="heading"><div><p class="muted"><a href="/sirket/pozisyonlar">Pozisyonlar</a> / Detay</p><h1>${escape(p.title)}</h1><span class="badge">Taslak</span></div></div><div class="grid" style="grid-template-columns:2fr 1fr"><div class="card"><h2>İş tanımı</h2><p style="white-space:pre-wrap">${escape(p.description)}</p></div><div class="card"><h2>Yetkinlikler</h2>${requirements.map(r=>`<p><strong>${escape(r.label)}</strong><br><span class="muted">%${r.weight} · ${r.required?'Zorunlu':'Tercih edilen'}</span></p>`).join('')}</div></div><p class="notice" style="margin-top:24px">Bu aşamada pozisyon taslak olarak kaydedilir. CV, davet ve mülakat işlemleri henüz etkin değildir.</p>`,{companyName:req.membership.name,active:'positions'});
});

app.get('/aday/giris',(req,res)=>authPage(req,res,'candidate'));
app.post('/aday/kod-iste',(req,res)=>{
  const email=String(req.body.email||'').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254) return authPage(req,res,'candidate','Geçerli bir e-posta adresi girin.',400);
  if(process.env.NODE_ENV!=='development') return res.status(503).send('Aday kodu gönderimi bu ortamda etkin değil.');
  const candidate=db.prepare('SELECT id FROM candidates WHERE email=?').get(email);
  const now=Date.now();
  if(candidate && db.prepare('SELECT COUNT(*) AS n FROM login_codes WHERE candidate_id=? AND created_at>?').get(candidate.id,now-10*60*1000).n<3){
    const code=String(randomInt(0,1000000)).padStart(6,'0');
    db.prepare('INSERT INTO login_codes (id,candidate_id,code_hash,expires_at,created_at) VALUES (?,?,?,?,?)').run(newId(),candidate.id,hashToken(code),now+10*60*1000,now);
    console.log(`[YALNIZCA GELİŞTİRME] ${email} için giriş kodu: ${code}`);
  }
  render(req,res,'Kod doğrulama',`<div class="auth-page"><section class="auth-intro"><div class="brand"><small>İşe alım platformu</small>Mülakat</div><h1>E-posta doğrulama</h1><p>Yalnızca davetli adaylar başvurularını görebilir.</p></section><section class="auth-panel"><div class="auth-box"><div class="card"><h2>Doğrulama kodu</h2><p class="muted">Adres kayıtlıysa kod gönderimi başlatıldı. Geliştirme ortamında kod sunucu terminalinde gösterilir.</p><form method="post" action="/aday/dogrula">${csrfField(req.session.csrf_token)}<input type="hidden" name="email" value="${escape(email)}"><div class="field"><label for="code">6 haneli kod</label><input id="code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></div><button class="button" type="submit">Doğrula</button></form></div><div class="auth-links"><a href="/aday/giris">← E-posta adresini değiştir</a></div></div></section></div>`);
});
app.post('/aday/dogrula',(req,res)=>{
  const email=String(req.body.email||'').trim().toLowerCase();
  const code=String(req.body.code||'');
  if(process.env.NODE_ENV!=='development' || !/^[0-9]{6}$/.test(code)) return res.status(401).send('Kod doğrulanamadı.');
  const candidate=db.prepare('SELECT id FROM candidates WHERE email=?').get(email);
  const row=candidate && db.prepare('SELECT * FROM login_codes WHERE candidate_id=? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1').get(candidate.id);
  if(!row || row.expires_at<Date.now() || row.attempts>=5){return res.status(401).send('Kod geçersiz veya süresi doldu. Yeni kod isteyin.');}
  db.prepare('UPDATE login_codes SET attempts=attempts+1 WHERE id=?').run(row.id);
  if(hashToken(code)!==row.code_hash) return res.status(401).send('Kod geçersiz veya süresi doldu. Yeni kod isteyin.');
  db.prepare('UPDATE login_codes SET consumed_at=? WHERE id=?').run(Date.now(),row.id);
  swapSession(req,res,'candidate',candidate.id);
  res.redirect('/aday');
});
app.get('/aday',requireCandidate,(req,res)=>{
  const candidate=db.prepare('SELECT full_name FROM candidates WHERE id=?').get(req.session.actor_id);
  if(!candidate) return res.status(403).send('Aday erişimi kaldırıldı.');
  const rows=db.prepare('SELECT a.id,a.status,a.created_at,p.title,o.name AS organization_name FROM applications a JOIN positions p ON p.id=a.position_id AND p.organization_id=a.organization_id JOIN organizations o ON o.id=a.organization_id WHERE a.candidate_id=? ORDER BY a.created_at DESC').all(req.session.actor_id);
  render(req,res,'Başvurularım',`<div class="heading"><div><h1>Başvurularım</h1><p class="muted">Davet edildiğiniz pozisyonların güncel durumu.</p></div></div><div class="card">${rows.length?`<div class="table-wrap"><table><thead><tr><th>Şirket</th><th>Pozisyon</th><th>Durum</th><th>Oluşturulma</th></tr></thead><tbody>${rows.map(a=>`<tr><td>${escape(a.organization_name)}</td><td>${escape(a.title)}</td><td><span class="badge">${({created:'Oluşturuldu',invited:'Davet edildi',interviewing:'Mülakatta',review:'İncelemede',completed:'Tamamlandı'})[a.status]}</span></td><td>${escape(a.created_at)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Henüz başvuru bulunmuyor.</div>'}</div><p class="muted" style="margin-top:18px">Bu aşamada mülakat ve itiraz işlemleri etkin değildir.</p>`,{companyName:candidate.full_name,active:'home'});
});
app.use((req,res)=>res.status(404).send('Sayfa bulunamadı.'));
const port=Number(process.env.PORT||3000);
if(!Number.isInteger(port)||port<1||port>65535) throw new Error('PORT geçersiz');
app.listen(port,()=>console.log(`Mülakat: http://localhost:${port}`));
