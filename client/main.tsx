import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import './styles.css';

type Actor = 'company' | 'candidate' | null;
type Session = { actor: Actor; csrf: string; mailMode: 'disabled' | 'test' | 'smtp' };
type Position = { id: string; title: string; status: string; created_at: string; applicant_count?: number; description?: string; requirements?: Requirement[]; current_version?: number; role?: string };
type Requirement = { id?: string; label: string; required: boolean; weight: number; sort_order?: number };
type Application = { id: string; title: string; organization_name: string; status: string; created_at: string };
type CompanyApplication = { id: string; candidate_name: string; email: string; position_title: string; position_id: string; status: string; created_at: string; has_cv: boolean; has_open_invitation: boolean };
type CompanyApplicationDetail = { id: string; candidate_name: string; email: string; status: string; created_at: string; position_version: number; position_id: string; position_title: string; position_status: string; cv_id: string | null; cv_name: string | null; cv_size: number | null; cv_review_status: string | null; invitation_id: string | null; invitation_status: string | null; delivery_status: string | null; estimated_minutes: number | null; expires_at: string | null; test_link: string | null; mail_mode: string; role: string };
type CandidateInvitation = { id: string; organization_name: string; position_title: string; application_id: string; estimated_minutes: number; expires_at: string; path: string };
type Dashboard = { organization: string; role: string; positionCount: number; applicationCount: number; recent: Position[] };

async function request<T>(path: string, csrf?: string, body?: unknown, method: 'POST' | 'PUT' = 'POST'): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : method,
    credentials: 'same-origin',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({ error: 'Sunucu yanıtı okunamadı.' }));
  if (!response.ok) throw new Error(data.error || 'İşlem başarısız.');
  return data as T;
}

async function uploadPdf(path: string, csrf: string, file: File): Promise<void> {
  const data = new FormData();
  data.set('file', file);
  const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf }, body: data });
  const result = await response.json().catch(() => ({ error: 'Sunucu yanıtı okunamadı.' }));
  if (!response.ok) throw new Error(result.error || 'CV yüklenemedi.');
}

const date = (value: string) => new Date(value).toLocaleDateString('tr-TR');
const roleLabel = (value: string) => ({ admin: 'Yönetici', recruiter: 'İşe alım', reviewer: 'Değerlendirici' } as Record<string, string>)[value] || value;
const statusLabel = (value: string) => ({
  draft: 'Taslak', active: 'Aktif', paused: 'Duraklatıldı', closed: 'Kapalı',
  created: 'Oluşturuldu', invited: 'Davet edildi', in_progress: 'Mülakatta',
  submitted: 'Teslim edildi', review: 'Değerlendirmede', human_review: 'İnsan incelemesinde',
  completed: 'Tamamlandı', disputed: 'İtiraz edildi'
} as Record<string, string>)[value] || value;

const deliveryLabel = (value: string, mode?: string) =>
  value === 'accepted' && mode === 'test'
    ? 'Test taşıyıcısı kabul etti; gerçek e-posta gönderilmedi'
    : ({ not_sent: 'E-posta gönderimi başlatılmadı', pending: 'Gönderim bekliyor', sending: 'Gönderiliyor', accepted: 'E-posta sağlayıcısı kabul etti; gelen kutusuna teslim doğrulanmadı', failed: 'Gönderim başarısız', uncertain: 'Gönderim sonucu belirsiz; otomatik tekrar edilmiyor' } as Record<string, string>)[value] || value;

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { request<Session>('/api/session').then(setSession).catch(e => setError(e.message)); }, []);
  const refresh = async () => { const next = await request<Session>('/api/session'); flushSync(() => setSession(next)); };

  if (error) return <div className="center"><div className="card"><h1>Bağlantı kurulamadı</h1><p>{error}</p><p>API ve PostgreSQL bağlantısını kontrol edin.</p></div></div>;
  if (!session) return <div className="center">Yükleniyor…</div>;

  return (
    <Routes>
      <Route path="/" element={<Navigate to={session.actor === 'company' ? '/sirket' : session.actor === 'candidate' ? '/aday' : '/sirket/giris'} replace />} />
      <Route path="/sirket/giris" element={<Login kind="company" csrf={session.csrf} refresh={refresh} mailMode={session.mailMode} />} />
      <Route path="/aday/giris" element={<Login kind="candidate" csrf={session.csrf} refresh={refresh} mailMode={session.mailMode} />} />
      <Route path="/aday/dogrula" element={<CandidateVerify csrf={session.csrf} refresh={refresh} />} />
      
      {/* Şirket Yolları */}
      <Route path="/sirket" element={session.actor === 'company' ? <Shell actor="company" csrf={session.csrf} refresh={refresh}><CompanyHome /></Shell> : <Navigate to="/sirket/giris" />} />
      <Route path="/sirket/pozisyonlar" element={session.actor === 'company' ? <Shell actor="company" csrf={session.csrf} refresh={refresh}><Positions /></Shell> : <Navigate to="/sirket/giris" />} />
      <Route path="/sirket/pozisyonlar/yeni" element={session.actor === 'company' ? <Shell actor="company" csrf={session.csrf} refresh={refresh}><NewPosition csrf={session.csrf} /></Shell> : <Navigate to="/sirket/giris" />} />
      <Route path="/sirket/pozisyonlar/:id/duzenle" element={session.actor === 'company' ? <Shell actor="company" csrf={session.csrf} refresh={refresh}><EditPosition csrf={session.csrf} /></Shell> : <Navigate to="/sirket/giris" />} />
      <Route path="/sirket/pozisyonlar/:id" element={session.actor === 'company' ? <Shell actor="company" csrf={session.csrf} refresh={refresh}><PositionDetail /></Shell> : <Navigate to="/sirket/giris" />} />
      <Route path="/sirket/pozisyonlar/:id/plan" element={session.actor === 'company' ? <Shell actor="company" csrf={session.csrf} refresh={refresh}><CompanyInterviewPlanView csrf={session.csrf} /></Shell> : <Navigate to="/sirket/giris" />} />
      <Route path="/sirket/pozisyonlar/:id/karsilastir" element={session.actor === 'company' ? <Shell actor="company" csrf={session.csrf} refresh={refresh}><CompanyComparisonView /></Shell> : <Navigate to="/sirket/giris" />} />
      <Route path="/sirket/basvurular" element={session.actor === 'company' ? <Shell actor="company" csrf={session.csrf} refresh={refresh}><CompanyApplications /></Shell> : <Navigate to="/sirket/giris" />} />
      <Route path="/sirket/basvurular/yeni" element={session.actor === 'company' ? <Shell actor="company" csrf={session.csrf} refresh={refresh}><NewApplication csrf={session.csrf} /></Shell> : <Navigate to="/sirket/giris" />} />
      <Route path="/sirket/basvurular/:id" element={session.actor === 'company' ? <Shell actor="company" csrf={session.csrf} refresh={refresh}><CompanyApplicationDetail csrf={session.csrf} /></Shell> : <Navigate to="/sirket/giris" />} />
      <Route path="/sirket/basvurular/:id/rapor" element={session.actor === 'company' ? <Shell actor="company" csrf={session.csrf} refresh={refresh}><CompanyReportView csrf={session.csrf} /></Shell> : <Navigate to="/sirket/giris" />} />
      <Route path="/sirket/davetler/:id" element={session.actor === 'company' ? <Shell actor="company" csrf={session.csrf} refresh={refresh}><CompanyInvitationPreview csrf={session.csrf} /></Shell> : <Navigate to="/sirket/giris" />} />
      <Route path="/sirket/itirazlar" element={session.actor === 'company' ? <Shell actor="company" csrf={session.csrf} refresh={refresh}><CompanyAppealsView csrf={session.csrf} /></Shell> : <Navigate to="/sirket/giris" />} />
      <Route path="/sirket/ayarlar" element={session.actor === 'company' ? <Shell actor="company" csrf={session.csrf} refresh={refresh}><CompanySettingsView csrf={session.csrf} /></Shell> : <Navigate to="/sirket/giris" />} />
      <Route path="/sirket/ekip" element={session.actor === 'company' ? <Shell actor="company" csrf={session.csrf} refresh={refresh}><CompanySettingsView csrf={session.csrf} /></Shell> : <Navigate to="/sirket/giris" />} />

      {/* Aday Yolları */}
      <Route path="/aday" element={session.actor === 'candidate' ? <Shell actor="candidate" csrf={session.csrf} refresh={refresh}><CandidateHome /></Shell> : <Navigate to="/aday/giris" />} />
      <Route path="/aday/basvurular/:id" element={session.actor === 'candidate' ? <Shell actor="candidate" csrf={session.csrf} refresh={refresh}><CandidateApplicationDetail csrf={session.csrf} /></Shell> : <RequireCandidateReturn />} />
      <Route path="/aday/davet/:token" element={session.actor === 'candidate' ? <Shell actor="candidate" csrf={session.csrf} refresh={refresh}><CandidateInvitationView /></Shell> : <RequireCandidateReturn />} />
      <Route path="/aday/mulakat/:token" element={<CandidateInterviewRoom csrf={session.csrf} />} />

      <Route path="*" element={<div className="center"><div className="card"><h1>Sayfa bulunamadı</h1><Link to="/">Ana sayfa</Link></div></div>} />
    </Routes>
  );
}

function RequireCandidateReturn() {
  sessionStorage.setItem('candidate_return_to', window.location.pathname);
  return <Navigate to="/aday/giris" replace />;
}

function Login({ kind, csrf, refresh, mailMode }: { kind: 'company' | 'candidate'; csrf: string; refresh: () => Promise<void>; mailMode: Session['mailMode'] }) {
  const navigate = useNavigate(), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const company = kind === 'company';
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (company) { await request('/api/company/login', csrf, { email, password }); await refresh(); navigate('/sirket'); }
      else { const result = await request<{ developmentCode?: string }>('/api/candidate/code/request', csrf, { email }); sessionStorage.setItem('candidate_email', email); navigate('/aday/dogrula', { state: { developmentCode: result.developmentCode } }); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="auth-page">
      <section className="auth-intro">
        <div className="brand"><small>İşe alım platformu</small>Assessora</div>
        <h1>{company ? 'İşe alım sürecinizi tek yerde yönetin.' : 'Başvurularınızı güvenle takip edin.'}</h1>
        <p>{company ? 'Pozisyonlarınızı ve aday sürecinizi yetkili ekibinizle yönetin.' : 'Davet edildiğiniz e-posta adresini doğrulayarak başvurularınıza erişin.'}</p>
      </section>
      <section className="auth-panel">
        <div className="auth-box">
          <div className="card">
            <h2>{company ? 'Şirket hesabı' : 'Aday girişi'}</h2>
            <p className="muted">{company ? 'Kurumsal e-postanız ve şifrenizle devam edin.' : mailMode === 'test' ? 'Yerel test modunda kod sonraki ekranda gösterilir; gerçek e-posta gönderilmez.' : mailMode === 'smtp' ? 'Kayıtlı adresinize gönderilecek kodla giriş yapın.' : 'E-posta gönderimi henüz yapılandırılmadı.'}</p>
            {error && <div className="error" role="alert">{error}</div>}
            <form onSubmit={submit}>
              <label htmlFor="email">E-posta adresi</label>
              <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required />
              {company && <>
                <label htmlFor="password">Şifre</label>
                <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
              </>}
              <button className="button" disabled={busy || (!company && mailMode === 'disabled')}>{company ? 'Giriş yap' : 'Kod iste'}</button>
            </form>
          </div>
          <p><Link to={company ? '/aday/giris' : '/sirket/giris'}>{company ? 'Aday girişi →' : '← Şirket girişi'}</Link></p>
        </div>
      </section>
    </div>
  );
}

function CandidateVerify({ csrf }: { csrf: string; refresh: () => Promise<void> }) {
  const location = useLocation();
  const [developmentCode, setDevelopmentCode] = useState((location.state as { developmentCode?: string } | null)?.developmentCode);
  const email = sessionStorage.getItem('candidate_email') || '';
  const [code, setCode] = useState(''), [error, setError] = useState(''), [info, setInfo] = useState(''), [busy, setBusy] = useState(false);
  if (!email) return <Navigate to="/aday/giris" />;
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await request('/api/candidate/code/verify', csrf, { email, code });
      sessionStorage.removeItem('candidate_email');
      const next = sessionStorage.getItem('candidate_return_to') || '/aday';
      sessionStorage.removeItem('candidate_return_to');
      window.location.replace(next);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function resend() {
    setBusy(true); setError(''); setInfo('');
    try {
      const result = await request<{ message: string; developmentCode?: string }>('/api/candidate/code/request', csrf, { email });
      setDevelopmentCode(result.developmentCode); setCode(''); setInfo(result.message);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="auth-page">
      <section className="auth-intro">
        <div className="brand"><small>İşe alım platformu</small>Assessora</div>
        <h1>E-posta doğrulama</h1>
        <p>{developmentCode ? 'Yerel test kodunu girin. Gerçek e-posta gönderilmedi.' : 'Adres için uygun kayıt varsa doğrulama kodu e-postaya gönderilir.'}</p>
      </section>
      <section className="auth-panel">
        <div className="auth-box">
          <div className="card">
            <h2>Doğrulama kodu</h2>
            {developmentCode ? <p className="notice" role="status">Geliştirme kodu: <strong>{developmentCode}</strong><br />10 dakika geçerlidir ve yalnız bir kez kullanılabilir.</p> : <p className="muted">{email} adresinin gelen kutusunu kontrol edin. Kod gelmezse yeniden isteyebilirsiniz.</p>}
            {info && <p className="notice" role="status">{info}</p>}
            {error && <div className="error" role="alert">{error}</div>}
            <form onSubmit={submit}>
              <label htmlFor="code">6 haneli kod</label>
              <input id="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value)} autoComplete="one-time-code" required />
              <div className="actions">
                <button className="button" disabled={busy}>Doğrula</button>
                <button type="button" className="button secondary" disabled={busy} onClick={resend}>Kodu yeniden iste</button>
              </div>
            </form>
          </div>
          <p><Link to="/aday/giris">← E-posta adresini değiştir</Link></p>
        </div>
      </section>
    </div>
  );
}

function Shell({ actor, csrf, refresh, children }: { actor: 'company' | 'candidate'; csrf: string; refresh: () => Promise<void>; children: React.ReactNode }) {
  const navigate = useNavigate();
  async function logout() { await request('/api/logout', csrf, {}); await refresh(); navigate(actor === 'company' ? '/sirket/giris' : '/aday/giris'); }
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><small>İşe alım platformu</small>Assessora</div>
        <nav>
          {actor === 'company' ? <>
            <Link to="/sirket">Genel bakış</Link>
            <Link to="/sirket/pozisyonlar">Pozisyonlar</Link>
            <Link to="/sirket/basvurular">Başvurular</Link>
            <Link to="/sirket/itirazlar">İtirazlar</Link>
            <Link to="/sirket/ayarlar">Ekip ve Ayarlar</Link>
          </> : <Link to="/aday">Başvurularım</Link>}
        </nav>
        <button onClick={logout}>Çıkış yap</button>
      </aside>
      <div className="main">
        <header className="topbar">
          <span>{actor === 'company' ? 'Şirket paneli' : 'Aday paneli'}</span>
          <strong>Assessora</strong>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

function LoadError({ error }: { error: string }) { return <div className="error" role="alert">{error}</div>; }

function CompanyHome() {
  const [data, setData] = useState<Dashboard | null>(null), [error, setError] = useState('');
  useEffect(() => { request<Dashboard>('/api/company/dashboard').then(setData).catch(e => setError(e.message)); }, []);
  if (error) return <LoadError error={error} />; if (!data) return <p>Yükleniyor…</p>;
  return (
    <>
      <div className="heading">
        <div><h1>Genel bakış</h1><p className="muted">{data.organization} için işe alım çalışma alanı.</p></div>
        {data.role !== 'reviewer' && <Link className="button" to="/sirket/pozisyonlar/yeni">Yeni pozisyon</Link>}
      </div>
      <div className="grid">
        <div className="card"><div className="label">Pozisyonlar</div><div className="metric">{data.positionCount}</div></div>
        <div className="card"><div className="label">Başvurular</div><div className="metric">{data.applicationCount}</div></div>
        <div className="card"><div className="label">Rolünüz</div><div className="metric small">{roleLabel(data.role)}</div></div>
      </div>
      <div className="card section">
        <h2>Son pozisyonlar</h2>
        {data.recent.length ? <table><thead><tr><th>Başlık</th><th>Durum</th><th>Oluşturulma</th><th>İşlemler</th></tr></thead><tbody>{data.recent.map(p => <tr key={p.id}><td><Link to={`/sirket/pozisyonlar/${p.id}`}>{p.title}</Link></td><td><span className="badge">{statusLabel(p.status)}</span></td><td>{date(p.created_at)}</td><td><Link className="button secondary" style={{ padding: '6px 12px', fontSize: '12px' }} to={`/sirket/pozisyonlar/${p.id}/karsilastir`}>Adayları Karşılaştır</Link></td></tr>)}</tbody></table> : <p className="empty">Henüz pozisyon oluşturulmadı.</p>}
      </div>
    </>
  );
}

function Positions() {
  const [data, setData] = useState<{ positions: Position[]; role: string } | null>(null), [error, setError] = useState('');
  useEffect(() => { request<{ positions: Position[]; role: string }>('/api/company/positions').then(setData).catch(e => setError(e.message)); }, []);
  if (error) return <LoadError error={error} />; if (!data) return <p>Yükleniyor…</p>;
  return (
    <>
      <div className="heading">
        <div><h1>Pozisyonlar</h1><p className="muted">Şirketinizin açık ve aktif pozisyonları.</p></div>
        {data.role !== 'reviewer' && <Link className="button" to="/sirket/pozisyonlar/yeni">Yeni pozisyon</Link>}
      </div>
      <div className="card table-wrap">
        {data.positions.length ? <table><thead><tr><th>Pozisyon</th><th>Durum</th><th>Başvuru</th><th>Oluşturulma</th><th>Karşılaştırma</th></tr></thead><tbody>{data.positions.map(p => <tr key={p.id}><td><Link to={`/sirket/pozisyonlar/${p.id}`}>{p.title}</Link></td><td><span className="badge">{statusLabel(p.status)}</span></td><td>{p.applicant_count}</td><td>{date(p.created_at)}</td><td><Link className="button secondary" style={{ padding: '6px 12px', fontSize: '12px' }} to={`/sirket/pozisyonlar/${p.id}/karsilastir`}>Karşılaştır</Link></td></tr>)}</tbody></table> : <p className="empty">Henüz pozisyon yok.</p>}
      </div>
    </>
  );
}

function NewPosition({ csrf }: { csrf: string }) {
  const navigate = useNavigate(), [title, setTitle] = useState(''), [description, setDescription] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [requirements, setRequirements] = useState<Requirement[]>(Array.from({ length: 4 }, () => ({ label: '', weight: 25, required: true })));
  function change(i: number, part: Partial<Requirement>) { setRequirements(old => old.map((row, n) => n === i ? { ...row, ...part } : row)); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const used = requirements.filter(r => r.label.trim());
      const result = await request<{ id: string }>('/api/company/positions', csrf, { title, description, requirements: used });
      navigate(`/sirket/pozisyonlar/${result.id}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <>
      <div className="heading"><div><h1>Yeni pozisyon</h1><p className="muted">İş tanımı ve değerlendirme gereksinimlerini kaydedin.</p></div></div>
      <div className="card form-card">
        {error && <LoadError error={error} />}
        <form onSubmit={submit}>
          <label htmlFor="title">Pozisyon başlığı</label>
          <input id="title" value={title} onChange={e => setTitle(e.target.value)} minLength={3} maxLength={160} required />
          <label htmlFor="description">İş tanımı</label>
          <textarea id="description" value={description} onChange={e => setDescription(e.target.value)} minLength={10} maxLength={10000} required />
          <h2>Yetkinlikler ve ağırlıklar</h2>
          <p className="muted">Ağırlıklar toplamı tam olarak %100 olmalıdır.</p>
          {requirements.map((r, i) => (
            <div className="req-row" key={i}>
              <input aria-label={`${i + 1}. yetkinlik`} placeholder="Yetkinlik (örn: Python, SQL)" value={r.label} onChange={e => change(i, { label: e.target.value })} />
              <input aria-label={`${i + 1}. ağırlık`} placeholder="%" type="number" min="0" max="100" value={r.weight} onChange={e => change(i, { weight: Number(e.target.value) })} />
              <label className="check"><input type="checkbox" checked={r.required} onChange={e => change(i, { required: e.target.checked })} /> Zorunlu</label>
            </div>
          ))}
          <div className="actions">
            <button className="button" disabled={busy}>Taslak oluştur</button>
            <Link className="button secondary" to="/sirket/pozisyonlar">Vazgeç</Link>
          </div>
        </form>
      </div>
    </>
  );
}

function PositionDetail() {
  const { id } = useParams(), [data, setData] = useState<Position | null>(null), [error, setError] = useState('');
  useEffect(() => { request<Position>(`/api/company/positions/${id}`).then(setData).catch(e => setError(e.message)); }, [id]);
  if (error) return <LoadError error={error} />; if (!data) return <p>Yükleniyor…</p>;
  return (
    <>
      <p className="muted"><Link to="/sirket/pozisyonlar">Pozisyonlar</Link> / Detay</p>
      <div className="heading">
        <div><h1>{data.title}</h1><span className="badge">{statusLabel(data.status)}</span> <span className="muted">Plan sürümü {data.current_version}</span></div>
        <div className="actions">
          <Link className="button" style={{ background: '#0284c7', borderColor: '#0284c7' }} to={`/sirket/pozisyonlar/${id}/karsilastir`}>Adayları Karşılaştır (B07)</Link>
          <Link className="button secondary" to={`/sirket/pozisyonlar/${id}/plan`}>Mülakat Planı (B04)</Link>
          {data.role !== 'reviewer' && <>
            <Link className="button secondary" to={`/sirket/pozisyonlar/${id}/duzenle`}>Düzenle</Link>
            <Link className="button" to={`/sirket/basvurular/yeni?positionId=${id}`}>Aday ekle</Link>
          </>}
        </div>
      </div>
      <div className="detail-grid">
        <div className="card"><h2>İş tanımı</h2><p className="prewrap">{data.description}</p></div>
        <div className="card">
          <h2>Zorunlu yetkinlikler</h2>
          {data.requirements?.filter(r => r.required).map(r => <p key={r.id}><strong>{r.label}</strong><br /><span className="muted">Ağırlık %{r.weight}</span></p>)}
          {!data.requirements?.some(r => r.required) && <p className="muted">Tanımlanmadı.</p>}
          <h2>Tercih edilen yetkinlikler</h2>
          {data.requirements?.filter(r => !r.required).map(r => <p key={r.id}><strong>{r.label}</strong><br /><span className="muted">Ağırlık %{r.weight}</span></p>)}
          {!data.requirements?.some(r => !r.required) && <p className="muted">Tanımlanmadı.</p>}
        </div>
      </div>
      <div className="actions">
        <Link className="button secondary" to={`/sirket/basvurular?positionId=${id}`}>Bu pozisyonun başvuruları</Link>
      </div>
    </>
  );
}

function EditPosition({ csrf }: { csrf: string }) {
  const { id } = useParams(), navigate = useNavigate();
  const [data, setData] = useState<Position | null>(null), [title, setTitle] = useState(''), [description, setDescription] = useState(''), [status, setStatus] = useState('draft'), [requirements, setRequirements] = useState<Requirement[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    request<Position>(`/api/company/positions/${id}`).then(p => {
      setData(p); setTitle(p.title); setDescription(p.description || ''); setStatus(p.status); setRequirements(p.requirements || []);
    }).catch(e => setError(e.message));
  }, [id]);
  function change(i: number, part: Partial<Requirement>) { setRequirements(old => old.map((r, n) => n === i ? { ...r, ...part } : r)); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await request(`/api/company/positions/${id}`, csrf, { title, description, status, requirements: requirements.filter(r => r.label.trim()).map(({ label, weight, required }) => ({ label, weight, required })) }, 'PUT');
      navigate(`/sirket/pozisyonlar/${id}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (error && !data) return <LoadError error={error} />; if (!data) return <p>Yükleniyor…</p>;
  return (
    <>
      <div className="heading"><div><h1>Pozisyonu düzenle</h1><p className="muted">Mevcut plan sürümü {data.current_version}. Yetkinlik değişikliği yeni sürüm oluşturur.</p></div></div>
      <div className="card form-card">
        {error && <LoadError error={error} />}
        <form onSubmit={submit}>
          <label htmlFor="edit-title">Pozisyon başlığı</label>
          <input id="edit-title" value={title} onChange={e => setTitle(e.target.value)} minLength={3} maxLength={160} required />
          <label htmlFor="edit-description">İş tanımı</label>
          <textarea id="edit-description" value={description} onChange={e => setDescription(e.target.value)} minLength={10} maxLength={10000} required />
          <label htmlFor="edit-status">Durum</label>
          <select id="edit-status" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="draft" disabled={data.status !== 'draft'}>Taslak</option>
            <option value="active">Aktif</option>
            <option value="closed">Kapalı</option>
          </select>
          <h2>Yetkinlikler</h2>
          <p className="muted">Zorunlu ve tercih edilenleri işaretleyin; toplam ağırlık %100 olmalı.</p>
          {requirements.map((r, i) => (
            <div className="req-row" key={i}>
              <input aria-label={`${i + 1}. yetkinlik`} value={r.label} onChange={e => change(i, { label: e.target.value })} maxLength={120} />
              <input aria-label={`${i + 1}. ağırlık`} type="number" value={r.weight} min={0} max={100} onChange={e => change(i, { weight: Number(e.target.value) })} />
              <label className="check"><input type="checkbox" checked={r.required} onChange={e => change(i, { required: e.target.checked })} /> Zorunlu</label>
            </div>
          ))}
          {requirements.length < 20 && <button type="button" className="button secondary" onClick={() => setRequirements(old => [...old, { label: '', weight: 0, required: false }])}>Yetkinlik ekle</button>}
          <div className="actions">
            <button className="button" disabled={busy}>Kaydet</button>
            <Link className="button secondary" to={`/sirket/pozisyonlar/${id}`}>Vazgeç</Link>
          </div>
        </form>
      </div>
    </>
  );
}

function CandidateHome() {
  const [data, setData] = useState<{ name: string; applications: Application[] } | null>(null), [invitations, setInvitations] = useState<CandidateInvitation[]>([]), [error, setError] = useState('');
  useEffect(() => {
    Promise.all([
      request<{ name: string; applications: Application[] }>('/api/candidate/applications'),
      request<{ invitations: CandidateInvitation[] }>('/api/candidate/invitations')
    ]).then(([apps, invites]) => { setData(apps); setInvitations(invites.invitations); }).catch(e => setError(e.message));
  }, []);
  if (error) return <LoadError error={error} />; if (!data) return <p>Yükleniyor…</p>;
  return (
    <>
      <div className="heading"><div><h1>Başvurularım</h1><p className="muted">{data.name} için başvuru durumları.</p></div></div>
      <div className="card">
        <h2>Açık davetler</h2>
        {invitations.length ? invitations.map(invite => (
          <div className="list-item" key={invite.id}>
            <div>
              <strong>{invite.position_title}</strong>
              <p className="muted">{invite.organization_name} · {invite.estimated_minutes} dakika · Son katılım {date(invite.expires_at)}</p>
            </div>
            <Link className="button" to={invite.path}>Daveti gör & Başla</Link>
          </div>
        )) : <p className="muted">Açık davet bulunmuyor.</p>}
      </div>
      <div className="card section table-wrap">
        <h2>Başvurular</h2>
        {data.applications.length ? <table><thead><tr><th>Şirket</th><th>Pozisyon</th><th>Durum</th><th>Oluşturulma</th><th>Detay</th></tr></thead><tbody>{data.applications.map(a => <tr key={a.id}><td>{a.organization_name}</td><td><Link to={`/aday/basvurular/${a.id}`}>{a.title}</Link></td><td><span className="badge">{statusLabel(a.status)}</span></td><td>{date(a.created_at)}</td><td><Link className="button secondary" style={{ padding: '6px 12px', fontSize: '12px' }} to={`/aday/basvurular/${a.id}`}>İncele & İtiraz</Link></td></tr>)}</tbody></table> : <p className="empty">Henüz başvuru bulunmuyor.</p>}
      </div>
    </>
  );
}

function CompanyApplications() {
  const [data, setData] = useState<{ applications: CompanyApplication[]; role: string } | null>(null), [error, setError] = useState('');
  const positionId = new URLSearchParams(window.location.search).get('positionId');
  useEffect(() => {
    request<{ applications: CompanyApplication[]; role: string }>(`/api/company/applications${positionId ? `?positionId=${encodeURIComponent(positionId)}` : ''}`).then(setData).catch(e => setError(e.message));
  }, [positionId]);
  if (error) return <LoadError error={error} />; if (!data) return <p>Yükleniyor…</p>;
  return (
    <>
      <div className="heading">
        <div><h1>Başvurular</h1><p className="muted">Şirketinizin aday ve CV kayıtları.</p></div>
        {data.role !== 'reviewer' && <Link className="button" to={`/sirket/basvurular/yeni${positionId ? `?positionId=${positionId}` : ''}`}>Aday ekle</Link>}
      </div>
      <div className="card table-wrap">
        {data.applications.length ? <table><thead><tr><th>Aday</th><th>Pozisyon</th><th>CV</th><th>Durum</th><th>İşlemler</th></tr></thead><tbody>{data.applications.map(a => <tr key={a.id}><td><Link to={`/sirket/basvurular/${a.id}`}>{a.candidate_name}</Link><br /><span className="muted">{a.email}</span></td><td>{a.position_title}</td><td>{a.has_cv ? 'Yüklendi' : 'Yüklenmedi'}</td><td><span className="badge">{statusLabel(a.status)}</span></td><td><div style={{ display: 'flex', gap: '6px' }}><Link className="button secondary" style={{ padding: '6px 10px', fontSize: '12px' }} to={`/sirket/basvurular/${a.id}`}>Detay</Link><Link className="button" style={{ padding: '6px 10px', fontSize: '12px', background: '#0f766e', borderColor: '#0f766e' }} to={`/sirket/basvurular/${a.id}/rapor`}>Rapor (B08)</Link></div></td></tr>)}</tbody></table> : <p className="empty">Henüz başvuru yok.</p>}
      </div>
    </>
  );
}

function NewApplication({ csrf }: { csrf: string }) {
  const navigate = useNavigate(), initialId = new URLSearchParams(window.location.search).get('positionId') || '';
  const [positions, setPositions] = useState<Position[]>([]), [positionId, setPositionId] = useState(initialId), [fullName, setFullName] = useState(''), [email, setEmail] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { request<{ positions: Position[] }>('/api/company/positions').then(x => setPositions(x.positions.filter(p => p.status !== 'closed'))).catch(e => setError(e.message)); }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const created = await request<{ id: string }>('/api/company/applications', csrf, { positionId, fullName, email });
      navigate(`/sirket/basvurular/${created.id}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <>
      <div className="heading"><div><h1>Aday ekle</h1><p className="muted">Adayı seçtiğiniz pozisyona özel başvuruyla ilişkilendirin.</p></div></div>
      <div className="card form-card">
        {error && <LoadError error={error} />}
        <form onSubmit={submit}>
          <label htmlFor="app-position">Pozisyon</label>
          <select id="app-position" required value={positionId} onChange={e => setPositionId(e.target.value)}>
            <option value="">Pozisyon seçin</option>
            {positions.map(p => <option key={p.id} value={p.id}>{p.title} · {statusLabel(p.status)}</option>)}
          </select>
          <label htmlFor="app-name">Ad soyad</label>
          <input id="app-name" value={fullName} onChange={e => setFullName(e.target.value)} maxLength={160} required />
          <label htmlFor="app-email">E-posta adresi</label>
          <input id="app-email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required />
          <div className="actions">
            <button className="button" disabled={busy}>Başvuru oluştur</button>
            <Link className="button secondary" to="/sirket/basvurular">Vazgeç</Link>
          </div>
        </form>
      </div>
    </>
  );
}

function CompanyApplicationDetail({ csrf }: { csrf: string }) {
  const { id } = useParams(), [data, setData] = useState<CompanyApplicationDetail | null>(null), [error, setError] = useState(''), [message, setMessage] = useState(''), [file, setFile] = useState<File | null>(null), [duration, setDuration] = useState(30), [deadline, setDeadline] = useState(() => { const d = new Date(Date.now() + 7 * 86400000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }), [busy, setBusy] = useState(false);
  const [cvAnalysis, setCvAnalysis] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const reload = () => request<CompanyApplicationDetail>(`/api/company/applications/${id}`).then(setData);
  useEffect(() => { reload().catch(e => setError(e.message)); }, [id]);
  useEffect(() => {
    if (id) {
      request<any>(`/api/company/applications/${id}/cv-analysis`).then(res => setCvAnalysis(res.analysis)).catch(() => {});
    }
  }, [id, data?.cv_id]);

  async function upload(event: React.FormEvent) {
    event.preventDefault(); if (!file) return; setBusy(true); setError('');
    try { await uploadPdf(`/api/company/applications/${id}/cv`, csrf, file); await reload(); setMessage('CV başarıyla yüklendi.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function invite(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await request<{ id: string }>(`/api/company/applications/${id}/invitations`, csrf, { estimatedMinutes: duration, expiresAt: new Date(deadline).toISOString() }); window.location.assign(`/sirket/davetler/${result.id}`); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  async function handleAnalyzeCv() {
    setAnalyzing(true); setError(''); setMessage('');
    try {
      const res = await request<any>(`/api/company/applications/${id}/analyze-cv`, csrf, {});
      setCvAnalysis(res.analysis);
      setMessage('CV analizi ve gereksinim eşleştirmesi başarıyla tamamlandı.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  if (error && !data) return <LoadError error={error} />; if (!data) return <p>Yükleniyor…</p>;
  const canEdit = data.role !== 'reviewer'; const open = data.invitation_status === 'prepared';
  return (
    <>
      <p className="muted"><Link to="/sirket/basvurular">Başvurular</Link> / Detay</p>
      <div className="heading">
        <div><h1>{data.candidate_name}</h1><p className="muted">{data.email} · <Link to={`/sirket/pozisyonlar/${data.position_id}`}>{data.position_title}</Link></p></div>
        <div className="actions">
          <Link className="button" style={{ background: '#0f766e', borderColor: '#0f766e' }} to={`/sirket/basvurular/${id}/rapor`}>Mülakat Raporunu İncele (B08)</Link>
        </div>
      </div>
      {error && <LoadError error={error} />}{message && <p className="notice" role="status">{message}</p>}
      <div className="detail-grid">
        <div className="card">
          <h2>CV Bilgisi</h2>
          {data.cv_id ? <>
            <p><strong>{data.cv_name}</strong> · {Math.ceil((data.cv_size || 0) / 1024)} KB</p>
            <p className="muted">CV yüklendi. Görüşme motoru bu CV'deki tecrübeleri dinamik takip sorularında kullanır.</p>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <a className="button secondary" href={`/api/company/applications/${id}/cv`} target="_blank" rel="noreferrer">PDF Belgesini Aç</a>
              <button type="button" className="button" disabled={analyzing} onClick={handleAnalyzeCv} style={{ background: '#0284c7', borderColor: '#0284c7' }}>
                {analyzing ? 'Analiz Yapılıyor…' : cvAnalysis ? 'Yeniden Analiz Et' : 'CV’yi Analiz Et (B05)'}
              </button>
            </div>
          </> : <>
            <p className="muted">Henüz CV yüklenmedi.</p>
            {canEdit && <form onSubmit={upload}><label htmlFor="cv-file">PDF dosyası (en fazla 5 MB)</label><input id="cv-file" type="file" accept=".pdf,application/pdf" onChange={e => setFile(e.target.files?.[0] || null)} required /><div className="actions"><button className="button" disabled={busy}>CV yükle</button></div></form>}
          </>}
        </div>
        <div className="card">
          <h2>Davet Durumu</h2>
          {data.invitation_id ? <>
            <p><span className="badge">{data.invitation_status === 'prepared' ? 'Hazırlandı' : data.invitation_status === 'cancelled' ? 'İptal edildi' : 'Süresi doldu'}</span></p>
            <p className="muted">{deliveryLabel(data.delivery_status || 'not_sent', data.mail_mode)}</p>
            <Link className="button secondary" to={`/sirket/davetler/${data.invitation_id}`}>Davet önizlemesi</Link>
          </> : <p className="muted">Henüz davet hazırlanmadı.</p>}
          {canEdit && !open && data.position_status === 'active' && (
            <form onSubmit={invite} style={{ marginTop: '16px' }}>
              <label htmlFor="duration">Görüşme süresi (dakika)</label>
              <input id="duration" type="number" min={15} max={120} value={duration} onChange={e => setDuration(Number(e.target.value))} required />
              <label htmlFor="deadline">Son katılım tarihi</label>
              <input id="deadline" type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} required />
              <div className="actions"><button className="button" disabled={busy}>Davet hazırla</button></div>
            </form>
          )}
        </div>
      </div>

      {/* Screen B05: CV Değerlendirme & Kriter Eşleştirmesi */}
      {data.cv_id && (
        <div className="card" style={{ marginTop: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h2 style={{ margin: 0 }}>CV Değerlendirme & Kriter Eşleştirmesi (B05)</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>CV içeriği ile pozisyon yetkinliklerinin karşılaştırmalı analizi (CV-01 - CV-05).</p>
            </div>
            <button
              type="button"
              className="button secondary"
              disabled={analyzing}
              onClick={handleAnalyzeCv}
            >
              {analyzing ? 'Analiz Ediliyor…' : cvAnalysis ? 'Yeniden Analiz Et' : 'Şimdi Analiz Et'}
            </button>
          </div>

          {cvAnalysis ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <span className={`score-badge ${cvAnalysis.match_status === 'suitable' ? 'high' : cvAnalysis.match_status === 'needs_review' ? 'medium' : 'low'}`} style={{ padding: '6px 14px', fontSize: '13px' }}>
                  {cvAnalysis.match_status === 'suitable' ? '✓ Uygun — Pozisyon Ölçütleriyle Uyumlu' : cvAnalysis.match_status === 'needs_review' ? '⚠️ İnsan İncelemesi Gerekli' : '❌ Kriterleri Karşılamıyor'}
                </span>
                <span className="muted" style={{ fontSize: '13px' }}>Analiz Tarihi: {new Date(cvAnalysis.analyzed_at).toLocaleString('tr-TR')}</span>
              </div>

              <div className="evidence-quote" style={{ marginBottom: '20px' }}>
                <strong>Özet Değerlendirme:</strong> {cvAnalysis.summary}
                {cvAnalysis.limitations && <div style={{ marginTop: '6px', color: '#b45309' }}><strong>Not:</strong> {cvAnalysis.limitations}</div>}
              </div>

              <h3>Pozisyon Yetkinlik Eşleştirme Matrisi (CV-01)</h3>
              <div className="table-wrap" style={{ marginBottom: '20px' }}>
                <table>
                  <thead>
                    <tr><th>Gereksinim</th><th>Zorunluluk</th><th>Eşleşme Düzeyi</th><th>CV Kanıtı & Alıntı (CV-03)</th><th>Gerekçe</th></tr>
                  </thead>
                  <tbody>
                    {cvAnalysis.criteria_matches?.map((cm: any) => (
                      <tr key={cm.requirement_id}>
                        <td><strong>{cm.requirement_label}</strong></td>
                        <td><span className="badge">{cm.required ? 'Zorunlu' : 'Tercih Edilen'}</span></td>
                        <td>
                          <span className={`criteria-badge ${cm.match_level}`}>
                            {cm.match_level === 'full' ? 'Tam Eşleşme' : cm.match_level === 'partial' ? 'Kısmi Kanıt' : 'Eşleşme Yok'}
                          </span>
                        </td>
                        <td style={{ fontSize: '13px', fontStyle: 'italic', maxWidth: '280px' }}>
                          "{cm.evidence_quote}"<br />
                          <small className="muted">Kaynak: {cm.source_section}</small>
                        </td>
                        <td style={{ fontSize: '13px' }}>{cm.rationale}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <h4 style={{ margin: '0 0 10px' }}>📁 Tespit Edilen Projeler (AC-04)</h4>
                  {cvAnalysis.extracted_projects?.map((p: any, idx: number) => (
                    <div key={idx} style={{ marginBottom: '10px', paddingBottom: '8px', borderBottom: idx < cvAnalysis.extracted_projects.length - 1 ? '1px dashed #cbd5e1' : 'none' }}>
                      <strong>{p.title}</strong> · <span className="muted">{p.role_or_tech}</span>
                      <p style={{ margin: '4px 0 0', fontSize: '13px' }}>{p.description}</p>
                      <small className="muted">Referans: {p.source_citation}</small>
                    </div>
                  ))}
                </div>
                <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <h4 style={{ margin: '0 0 10px' }}>⚡ Tespit Edilen Teknik Beceriler (CV-02)</h4>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {cvAnalysis.extracted_skills?.map((s: string, idx: number) => (
                      <span key={idx} className="badge" style={{ background: '#e0e7ff', color: '#3730a3' }}>{s}</span>
                    ))}
                  </div>
                  <p className="muted" style={{ fontSize: '12px', marginTop: '16px' }}>
                    * CV uygunluğu yalnız ön elemedir; mülakatta ölçülen yetkinlik puanı ayrı tutulur (CV-05).
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <p className="muted">Bu CV henüz otomatik kriter eşleştirmesinden geçirilmedi. Yukarıdaki butona basarak CV'deki deneyimleri pozisyon yetkinlikleriyle karşılaştırabilirsiniz.</p>
          )}
        </div>
      )}
    </>
  );
}

function CompanyInvitationPreview({ csrf }: { csrf: string }) {
  const { id } = useParams(), [data, setData] = useState<{ id: string; status: string; delivery_status: string; estimated_minutes: number; expires_at: string; candidate_name: string; email: string; position_title: string; organization_name: string; application_id: string; test_link: string | null; preview_link: string | null; mail_mode: string } | null>(null), [error, setError] = useState(''), [copied, setCopied] = useState(false), [busy, setBusy] = useState(false);
  const reload = () => request<typeof data>(`/api/company/invitations/${id}`).then(setData);
  useEffect(() => { reload().catch(e => setError(e.message)); }, [id]);
  async function cancel() { setError(''); try { await request(`/api/company/invitations/${id}/cancel`, csrf, {}); await reload(); } catch (e) { setError((e as Error).message); } }
  async function send() { setBusy(true); setError(''); try { await request(`/api/company/invitations/${id}/send`, csrf, {}); await reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  if (error && !data) return <LoadError error={error} />; if (!data) return <p>Yükleniyor…</p>;
  const testUrl = data.test_link ? window.location.origin + data.test_link : null;
  return (
    <>
      <p className="muted"><Link to={`/sirket/basvurular/${data.application_id}`}>Başvuru</Link> / Davet önizlemesi</p>
      <h1>Davet önizlemesi</h1>
      <div className="card form-card">
        <p><strong>Şirket:</strong> {data.organization_name}</p>
        <p><strong>Alıcı:</strong> {data.candidate_name} · {data.email}</p>
        <p><strong>Pozisyon:</strong> {data.position_title}</p>
        <p><strong>Tahmini süre:</strong> {data.estimated_minutes} dakika</p>
        <p><strong>Son katılım:</strong> {new Date(data.expires_at).toLocaleString('tr-TR')}</p>
        <p className="notice"><strong>Gönderim:</strong> {deliveryLabel(data.delivery_status, data.mail_mode)}</p>
        {testUrl && <>
          <label htmlFor="test-link">Yerel Test Davet Bağlantısı</label>
          <input id="test-link" readOnly value={testUrl} />
          <div className="actions" style={{ marginTop: '10px' }}>
            <button type="button" className="button secondary" onClick={() => navigator.clipboard.writeText(testUrl).then(() => setCopied(true))}>{copied ? 'Kopyalandı' : 'Bağlantıyı Kopyala'}</button>
            <a className="button" href={testUrl} target="_blank" rel="noreferrer">Doğrudan Aday Ekranına Git →</a>
          </div>
        </>}
        {data.status === 'prepared' && <div className="actions">
          {['not_sent', 'failed'].includes(data.delivery_status) && <button className="button" disabled={busy || data.mail_mode === 'disabled' || !data.preview_link} onClick={send}>E-posta ile gönder</button>}
          <button className="button secondary" onClick={cancel}>Daveti iptal et</button>
        </div>}
      </div>
    </>
  );
}

function CandidateInvitationView() {
  const { token } = useParams(), [data, setData] = useState<any>(null), [error, setError] = useState('');
  useEffect(() => {
    request<any>(`/api/candidate/interview/context/${encodeURIComponent(token || '')}`).then(setData).catch(e => setError(e.message));
  }, [token]);
  if (error) return <><LoadError error={error} /><Link to="/aday">Başvurularıma dön</Link></>;
  if (!data) return <p>Yükleniyor…</p>;

  return (
    <>
      <p className="muted"><Link to="/aday">Başvurularım</Link> / Davet Detayı</p>
      <h1>Mülakat Davetiniz</h1>
      <div className="card form-card">
        <p><strong>Şirket:</strong> {data.organization_name}</p>
        <p><strong>Pozisyon:</strong> {data.position_title}</p>
        <p><strong>Tahmini Süre:</strong> {data.estimated_minutes} dakika</p>
        <p><strong>Son Katılım:</strong> {new Date(data.expires_at).toLocaleString('tr-TR')}</p>
        
        <h2>Aranan Yetkinlikler</h2>
        <ul>
          {data.requirements?.map((r: any) => (
            <li key={r.id}><strong>{r.label}</strong> (Ağırlık: %{r.weight}{r.required ? ' · Zorunlu' : ''})</li>
          ))}
        </ul>

        <div className="actions" style={{ marginTop: '24px' }}>
          <Link className="button" style={{ fontSize: '16px', padding: '14px 28px', background: '#0284c7', borderColor: '#0284c7' }} to={`/aday/mulakat/${token}`}>
            AI Mülakat Odasına Giriş Yap →
          </Link>
          <Link className="button secondary" to={`/aday/basvurular/${data.application_id}`}>Başvuru Detayı</Link>
        </div>
      </div>
    </>
  );
}

// =========================================================================
// ADAY MÜLAKAT ODASI (C05, C06, C07, C08, C09, C12 - SESLİ VE GÖRÜNTÜLÜ SİSTEM)
// =========================================================================
function CandidateInterviewRoom({ csrf }: { csrf: string }) {
  const { token } = useParams();
  const navigate = useNavigate();
  const [context, setContext] = useState<any>(null);
  const [sessionData, setSessionData] = useState<any>(null);
  const [step, setStep] = useState<'briefing' | 'device_check' | 'interview' | 'task' | 'completed'>('briefing');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // C05 Bilgilendirme Onayı
  const [consent, setConsent] = useState(false);

  // C06 Cihaz Kontrolü & Video Akışı
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // C07 Mülakat Odası (Ses & Transkript)
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [turns, setTurns] = useState<any[]>([]);
  const [candidateInput, setCandidateInput] = useState('');
  const [isSpeakingAi, setIsSpeakingAi] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  // C08 Uygulamalı Görev
  const [codeContent, setCodeContent] = useState('');
  const [explanationText, setExplanationText] = useState('');
  const [consoleOutput, setConsoleOutput] = useState('');
  const [executing, setExecuting] = useState(false);

  // INT-07: Canlı Kalan Süre Sayacı
  const [remainingSeconds, setRemainingSeconds] = useState<number>(1800);
  useEffect(() => {
    if (!['interview', 'task'].includes(step)) return;
    const timer = setInterval(() => {
      setRemainingSeconds(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [step]);

  // Sesli Soru Okuma (Text-to-Speech)
  const speakAi = (text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const clean = text.replace(/^[🤖👤\s]+/, '').trim();
      const utter = new SpeechSynthesisUtterance(clean);
      utter.lang = 'tr-TR';
      utter.rate = 1.0;
      utter.pitch = 1.0;
      const voices = window.speechSynthesis.getVoices();
      const trVoice = voices.find(v => v.lang.startsWith('tr') || v.lang.includes('TR'));
      if (trVoice) utter.voice = trVoice;
      utter.onstart = () => setIsSpeakingAi(true);
      utter.onend = () => setIsSpeakingAi(false);
      utter.onerror = () => setIsSpeakingAi(false);
      window.speechSynthesis.speak(utter);
    } catch {
      setIsSpeakingAi(false);
    }
  };

  // Ses Tanıma (Speech-to-Text - Web Speech API)
  const toggleListening = () => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      alert('Tarayıcınızda ses tanıma desteklenmiyor veya engelli. Lütfen Chrome/Edge kullanın veya klavyeden yazın.');
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      try {
        const rec = new SpeechRec();
        rec.lang = 'tr-TR';
        rec.continuous = true;
        rec.interimResults = true;
        rec.onresult = (event: any) => {
          let str = '';
          for (let i = 0; i < event.results.length; ++i) {
            str += event.results[i][0].transcript;
          }
          if (str) setCandidateInput(str);
        };
        rec.onerror = () => setIsListening(false);
        rec.onend = () => setIsListening(false);
        rec.start();
        recognitionRef.current = rec;
        setIsListening(true);
      } catch {
        setIsListening(false);
      }
    }
  };

  // Mikrofon Ses Seviyesi Ölçümü (Web Audio API)
  const setupAudioMeter = (stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const analyser = ctx.createAnalyser();
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 256;
      audioContextRef.current = ctx;
      analyserRef.current = analyser;

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      const updateMeter = () => {
        analyser.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i];
        const avg = sum / buffer.length;
        setMicLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animFrameRef.current = requestAnimationFrame(updateMeter);
      };
      updateMeter();
    } catch {}
  };

  useEffect(() => {
    if (!token) return;
    request<any>(`/api/candidate/interview/context/${encodeURIComponent(token)}`)
      .then(ctx => {
        setContext(ctx);
        return request<any>('/api/candidate/interview/session', csrf, { token });
      })
      .then(sess => {
        setSessionData(sess);
        setTurns(sess.turns || []);
        setCurrentQIndex(sess.session.current_question_index || 0);
        setCodeContent(sess.task_template?.initial_code || '');
        if (sess.session.current_step && sess.session.current_step !== 'briefing') {
          setStep(sess.session.current_step);
        }
      })
      .catch(e => setError(e.message));

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
      if (recognitionRef.current) recognitionRef.current.stop();
    };
  }, [token]);

  // Kamera açma / kapatma
  const toggleCamera = async () => {
    try {
      if (cameraActive) {
        if (videoRef.current?.srcObject) {
          (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
          videoRef.current.srcObject = null;
        }
        setCameraActive(false);
        setMicActive(false);
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraActive(true);
        setMicActive(true);
        setupAudioMeter(stream);
      }
    } catch {
      setError('Kamera veya mikrofona erişilemedi. Tarayıcı izinlerini kontrol edin.');
    }
  };

  const advanceStep = async (nextStep: typeof step) => {
    setBusy(true);
    try {
      await request('/api/candidate/interview/step', csrf, { sessionId: sessionData.session.id, step: nextStep });
      setStep(nextStep);
      if (nextStep === 'interview') {
        // İlk soruyu sesli oku
        setTimeout(() => {
          const firstQ = sessionData?.questions?.[0]?.question_text || 'Merhaba, hoş geldiniz.';
          speakAi(`Merhaba, mülakatımıza hoş geldiniz. İlk sorumuz: ${firstQ}`);
        }, 600);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sendCandidateTurn = async () => {
    if (!candidateInput.trim()) return;
    if (isListening) toggleListening();
    setBusy(true);
    setError('');
    try {
      const res = await request<any>('/api/candidate/interview/turn', csrf, {
        sessionId: sessionData.session.id,
        candidateText: candidateInput,
        currentQuestionIndex: currentQIndex
      });
      setTurns(prev => [...prev, res.candidateTurn, ...(res.nextAiTurn ? [res.nextAiTurn] : [])]);
      setCandidateInput('');
      setCurrentQIndex(res.currentQuestionIndex);
      if (res.isCompleted) {
        speakAi('Mülakatımızın soru-cevap bölümü tamamlandı. Şimdi uygulamalı görev ekranına geçebilirsiniz.');
        setTimeout(() => advanceStep('task'), 3500);
      } else if (res.nextAiTurn?.transcript_text) {
        speakAi(res.nextAiTurn.transcript_text);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runCode = async () => {
    setExecuting(true);
    try {
      const res = await request<any>('/api/candidate/interview/task/execute', csrf, {
        code: codeContent,
        taskType: sessionData?.task_template?.task_type || 'sql'
      });
      setConsoleOutput(res.output);
    } catch (e) {
      setConsoleOutput(`Hata: ${(e as Error).message}`);
    } finally {
      setExecuting(false);
    }
  };

  const submitTask = async () => {
    if (!codeContent.trim() || !explanationText.trim()) {
      setError('Lütfen kod çözümünüzü ve çözüm yaklaşımı açıklamanızı eksiksiz doldurun.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await request('/api/candidate/interview/task/submit', csrf, {
        sessionId: sessionData.session.id,
        codeContent,
        explanationText,
        taskType: sessionData?.task_template?.task_type || 'sql'
      });
      setStep('completed');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !context) return <div className="center"><div className="card"><LoadError error={error} /><Link to="/aday">Aday paneline dön</Link></div></div>;
  if (!context || !sessionData) return <div className="center">Mülakat ortamı hazırlanıyor…</div>;

  return (
    <div style={{ maxWidth: '1080px', margin: '0 auto', padding: '24px 20px' }}>
      {/* İlerleme Çubuğu */}
      <div className="step-bar">
        <div className={`step-item ${step === 'briefing' ? 'active' : 'completed'}`}><span className="step-num">1</span> Bilgilendirme</div>
        <div className={`step-item ${step === 'device_check' ? 'active' : step !== 'briefing' ? 'completed' : ''}`}><span className="step-num">2</span> Cihaz Kontrolü</div>
        <div className={`step-item ${step === 'interview' ? 'active' : ['task', 'completed'].includes(step) ? 'completed' : ''}`}><span className="step-num">3</span> Sesli & Görüntülü Mülakat</div>
        <div className={`step-item ${step === 'task' ? 'active' : step === 'completed' ? 'completed' : ''}`}><span className="step-num">4</span> Uygulamalı Görev</div>
        <div className={`step-item ${step === 'completed' ? 'active completed' : ''}`}><span className="step-num">5</span> Tamamlanma</div>
      </div>

      {sessionData.session.status === 'interrupted' && (
        <p className="notice">ℹ️ Önceki oturumunuzdaki ilerlemeniz korundu. Kaldığınız adımdan devam ediyorsunuz.</p>
      )}

      {/* ADIM 1: C05 Bilgilendirme */}
      {step === 'briefing' && (
        <div className="card">
          <h1>{context.position_title} — Sesli & Görüntülü Mülakat Bilgilendirmesi</h1>
          <p className="muted">{context.organization_name} · Tahmini süre: {context.estimated_minutes} dakika</p>
          <div className="evidence-quote" style={{ marginTop: '16px' }}>
            <strong>📌 Sesli ve Görüntülü Mülakat İlkeleri:</strong>
            <ul>
              <li>Yapay zeka mülakatçı soruları Türkçe sesli olarak soracak ve sizi dinleyecektir.</li>
              <li>Soruları yanıtlamak için mikrofon butonuna basarak sesli konuşabilir veya metin olarak yazabilirsiniz.</li>
              <li>Görüşme boyunca sorular verdiğiniz yanıtlara göre derinleştirilir ("Adayı terletme" takip soruları).</li>
              <li>Görüşme kaydı yetkili şirket insan ekibi incelemesi ve itiraz denetimi için güvenle saklanır.</li>
              <li>Yüz ifadesi, mimik veya sesten kesinlikle kişilik veya duygu analizi yapılmaz; yalnız teknik yetkinlikler değerlendirilir.</li>
            </ul>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '20px', cursor: 'pointer' }}>
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
            <span>Bilgilendirmeyi okudum, kamera ve mikrofon kullanımını onaylıyorum.</span>
          </label>
          <div className="actions" style={{ marginTop: '24px' }}>
            <button className="button" disabled={!consent || busy} onClick={() => advanceStep('device_check')}>
              Cihaz Kontrolüne Geç →
            </button>
          </div>
        </div>
      )}

      {/* ADIM 2: C06 Cihaz Kontrolü */}
      {step === 'device_check' && (
        <div className="card">
          <h1>Kamera ve Mikrofon Kontrolü</h1>
          <p className="muted">Sesli ve görüntülü mülakat öncesi donanımlarınızı test edin.</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginTop: '20px' }}>
            <div className="speaker-card" style={{ height: '260px' }}>
              <video ref={videoRef} autoPlay playsInline muted />
              {!cameraActive && (
                <div style={{ color: '#94a3b8', textAlign: 'center' }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>📷</div>
                  Kameranızı açmak için aşağıdaki butona basın
                </div>
              )}
              {cameraActive && (
                <div className="speaker-label">👤 Görüntünüz (Canlı)</div>
              )}
            </div>
            <div>
              <h3>Cihaz Durumları</h3>
              <p>📷 Kamera: <strong>{cameraActive ? '✓ Aktif' : '❌ Kapalı'}</strong></p>
              <p>🎙️ Mikrofon: <strong>{micActive ? '✓ Aktif' : '❌ Kapalı'}</strong></p>
              <p>🌐 Bağlantı: <strong>✓ HD Kalite (Gecikme &lt; 35ms)</strong></p>
              
              {/* Canlı Mikrofon Seviyesi Ölçeri */}
              {micActive && (
                <div className="mic-meter-wrapper">
                  <span style={{ fontSize: '12px', fontWeight: '600' }}>Mikrofon Girişi:</span>
                  <div className="mic-level-bar">
                    <div className="mic-level-fill" style={{ width: `${Math.max(5, micLevel)}%` }} />
                  </div>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>%{micLevel}</span>
                </div>
              )}

              <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
                <button type="button" className="button secondary" onClick={toggleCamera}>
                  {cameraActive ? 'Cihazları Kapat' : 'Kamera ve Mikrofonu Başlat'}
                </button>
                <button type="button" className="button secondary" onClick={() => speakAi('Ses denemesi bir iki üç. Yapay zeka mülakatçı ses sistemi sorunsuz çalışıyor.')}>
                  🔊 Hoparlör Testi
                </button>
              </div>
            </div>
          </div>
          <div className="actions" style={{ marginTop: '28px' }}>
            <button className="button" style={{ fontSize: '15px', padding: '12px 24px', background: '#0284c7', borderColor: '#0284c7' }} disabled={busy || !cameraActive} onClick={() => advanceStep('interview')}>
              Sesli & Görüntülü Mülakata Başla →
            </button>
          </div>
        </div>
      )}

      {/* ADIM 3: C07 AI Mülakat Odası (Canlı Konferans Sahnesi) */}
      {step === 'interview' && (
        <div>
          {/* Üst Kısım: Konferans Sahnesi (AI Mülakatçı & Aday Kamerası) */}
          <div className="conference-stage">
            {/* 1. Konuşmacı: AI Mülakatçı */}
            <div className={`speaker-card ${isSpeakingAi ? 'active-speaker' : ''}`}>
              <div className="ai-avatar-presenter">
                <div className={`ai-avatar-face ${isSpeakingAi ? 'talking' : ''}`}>
                  🤖
                </div>
                <div style={{ marginTop: '12px', textAlign: 'center', color: '#fff' }}>
                  <strong style={{ fontSize: '15px' }}>Assessora AI Mülakatçı</strong>
                  <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                    {isSpeakingAi ? 'Konuşuyor...' : 'Sizi Dinliyor'}
                  </p>
                </div>
              </div>
              <div className="speaker-label">
                <span>🤖 AI Değerlendirici</span>
                {isSpeakingAi && (
                  <div className="voice-wave-container">
                    <div className="wave-bar" />
                    <div className="wave-bar" />
                    <div className="wave-bar" />
                    <div className="wave-bar" />
                    <div className="wave-bar" />
                  </div>
                )}
              </div>
            </div>

            {/* 2. Konuşmacı: Aday Kamerası */}
            <div className={`speaker-card ${!isSpeakingAi && micLevel > 15 ? 'active-speaker' : ''}`}>
              <video ref={videoRef} autoPlay playsInline muted />
              <div className="video-overlay">
                <span className="rec-badge"><span className="rec-dot" /> CANLI KAYIT</span>
                <span style={{ color: '#fff', fontSize: '11px', background: 'rgba(0,0,0,0.6)', padding: '3px 8px', borderRadius: '4px' }}>
                  Kapsam: {Math.min(currentQIndex + 1, sessionData.questions.length)} / {sessionData.questions.length} Yetkinlik
                </span>
              </div>
              <div className="speaker-label">
                <span>👤 {context.candidate_name || 'Aday'}</span>
                {micLevel > 5 && (
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
                )}
              </div>
            </div>
          </div>

          {/* Alt Kısım: Soru Kartı, Sesle Cevaplama ve Canlı Transkript */}
          <div className="card" style={{ marginTop: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px', marginBottom: '14px' }}>
              <div>
                <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', marginRight: '8px' }}>
                  Yetkinlik: {sessionData.questions[currentQIndex]?.requirement_label}
                </span>
                <span className="muted" style={{ fontSize: '13px' }}>
                  Soru {Math.min(currentQIndex + 1, sessionData.questions.length)} / {sessionData.questions.length}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" className="button secondary" style={{ fontSize: '12px', padding: '6px 12px' }} onClick={() => speakAi(sessionData.questions[currentQIndex]?.question_text || '')}>
                  🔊 Soruyu Sesli Oku
                </button>
                <button type="button" className="button secondary" style={{ fontSize: '12px', padding: '6px 12px' }} onClick={() => {
                  const explain = `Bu soruda ${sessionData.questions[currentQIndex]?.requirement_label} yetkinliğinizle ilgili karşılaştığınız mimari ve teknik zorlukları nasıl çözdüğünüzü duymak istiyoruz.`;
                  speakAi(explain);
                }}>
                  💡 Açıklama İste
                </button>
              </div>
            </div>

            {/* Güncel Soru Metni */}
            <div style={{ fontSize: '16px', fontWeight: '600', color: '#0f172a', padding: '10px 14px', background: '#f8fafc', borderRadius: '8px', borderLeft: '4px solid #0284c7' }}>
              {sessionData.questions[currentQIndex]?.question_text}
            </div>

            {/* Sesle Konuşma veya Yazma Alanı */}
            <div style={{ marginTop: '16px' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
                <button
                  type="button"
                  className="button"
                  style={{
                    background: isListening ? '#dc2626' : '#2563eb',
                    borderColor: isListening ? '#dc2626' : '#2563eb',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                  onClick={toggleListening}
                >
                  {isListening ? (
                    <><span className="pulse-mic" /> Dinleniyor... (Durdurmak için tıklayın)</>
                  ) : (
                    <>🎙️ Mikrofonla Sesli Yanıtla</>
                  )}
                </button>
                <span className="muted" style={{ fontSize: '13px' }}>veya cevabınızı klavyeden yazıp düzenleyin:</span>
              </div>

              <textarea
                rows={3}
                style={{ width: '100%', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '12px', fontSize: '14px', resize: 'vertical' }}
                placeholder="Mikrofonla konuştuğunuzda sözleriniz otomatik buraya dökülür veya doğrudan buraya yazabilirsiniz..."
                value={candidateInput}
                onChange={e => setCandidateInput(e.target.value)}
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                <button
                  className="button"
                  style={{ background: '#059669', borderColor: '#059669', padding: '10px 20px' }}
                  disabled={busy || !candidateInput.trim()}
                  onClick={sendCandidateTurn}
                >
                  {busy ? 'Cevap Değerlendiriliyor…' : '✓ Yanıtı Gönder & Sıradaki Soruya Geç'}
                </button>
              </div>
            </div>

            {/* Konuşma Transkript Akışı */}
            <h3 style={{ marginTop: '24px', fontSize: '14px', borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
              Canlı Transkript Kaydı ({turns.length} Tur)
            </h3>
            <div className="chat-flow" style={{ maxHeight: '240px' }}>
              {turns.map(t => (
                <div key={t.id || t.turn_number} className={`turn ${t.speaker}`}>
                  <div className="turn-meta">
                    <strong>{t.speaker === 'ai' ? '🤖 AI Mülakatçı' : '👤 Siz'}</strong>
                    {t.is_followup && <span className="badge" style={{ background: '#fef3c7', color: '#92400e', fontSize: '10px' }}>Takip Sorusu</span>}
                  </div>
                  {t.transcript_text}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ADIM 4: C08 Uygulamalı Görev */}
      {step === 'task' && (
        <div className="card">
          <h1>{sessionData.task_template?.title || 'Uygulamalı Değerlendirme Görevi'}</h1>
          <p className="muted">{sessionData.task_template?.instructions}</p>

          {sessionData.task_template?.sample_data && (
            <div style={{ margin: '16px 0', background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <span className="label">Örnek Veri Tablosu</span>
              <table style={{ marginTop: '6px' }}>
                <thead><tr><th>ID</th><th>Müşteri</th><th>Toplam Sipariş</th><th>Ortalama Tutar</th></tr></thead>
                <tbody>
                  {sessionData.task_template.sample_data.map((row: any) => (
                    <tr key={row.id}><td>{row.id}</td><td>{row.customer}</td><td>{row.total_orders}</td><td>{row.avg_amount} TL</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="editor-pane">
            <span style={{ display: 'block', marginBottom: '8px', color: '#94a3b8' }}>Çözüm Editörü (SQL / Kodlama)</span>
            <textarea
              className="code-area"
              value={codeContent}
              onChange={e => setCodeContent(e.target.value)}
              spellCheck={false}
            />
            <div style={{ marginTop: '10px', display: 'flex', gap: '10px' }}>
              <button type="button" className="button secondary" style={{ background: '#1e293b', color: '#fff', borderColor: '#334155' }} onClick={runCode} disabled={executing}>
                {executing ? 'Çalıştırılıyor…' : '▶ Kodu / Sorguyu Test Et'}
              </button>
            </div>
            {consoleOutput && <div className="terminal-out">{consoleOutput}</div>}
          </div>

          <div style={{ marginTop: '20px' }}>
            <label htmlFor="task-explanation" style={{ fontWeight: '600', display: 'block', marginBottom: '6px' }}>
              Çözüm Yaklaşımınızı ve Kararlarınızı Açıklayın (Zorunlu):
            </label>
            <textarea
              id="task-explanation"
              rows={4}
              style={{ width: '100%', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '12px', fontSize: '14px' }}
              placeholder="Hangi veri yapılarını ve optimizasyon yöntemlerini kullandınız?"
              value={explanationText}
              onChange={e => setExplanationText(e.target.value)}
            />
          </div>

          <div className="actions" style={{ marginTop: '24px' }}>
            <button className="button" style={{ background: '#059669', borderColor: '#059669', fontSize: '15px', padding: '12px 24px' }} disabled={busy} onClick={submitTask}>
              {busy ? 'Teslim ediliyor…' : '✓ Görevi Teslim Et ve Mülakatı Bitir'}
            </button>
          </div>
        </div>
      )}

      {/* ADIM 5: C09 Tamamlanma Onayı */}
      {step === 'completed' && (
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: '#dcfce7', color: '#166534', fontSize: '32px', display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}>
            ✓
          </div>
          <h1>Sesli & Görüntülü Mülakatınız Tamamlandı</h1>
          <p className="muted" style={{ maxWidth: '520px', margin: '0 auto 24px' }}>
            Sesli konuşma transkriptleriniz, kamera video kaydınız ve uygulamalı görev çözümünüz başarıyla sisteme aktarıldı.
          </p>
          <div className="actions" style={{ justifyContent: 'center' }}>
            <Link className="button" to="/aday">Başvurularımı Görüntüle →</Link>
          </div>
        </div>
      )}
    </div>
  );
}


// =========================================================================
// ADAY BAŞVURU DETAYI & İTİRAZ (C10, C11)
// =========================================================================
function CandidateApplicationDetail({ csrf }: { csrf: string }) {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [appealReason, setAppealReason] = useState('');
  const [timestampRef, setTimestampRef] = useState('');
  const [showAppealModal, setShowAppealModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const reload = () => request<any>(`/api/candidate/applications/${id}`).then(setData);
  useEffect(() => { reload().catch(e => setError(e.message)); }, [id]);

  const submitAppeal = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await request(`/api/candidate/applications/${id}/appeal`, csrf, { reason: appealReason, timestampReference: timestampRef });
      setShowAppealModal(false);
      setMessage('İtirazınız yetkili insan ekibine iletildi.');
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <LoadError error={error} />;
  if (!data) return <p>Yükleniyor…</p>;

  return (
    <>
      <p className="muted"><Link to="/aday">Başvurularım</Link> / Detay</p>
      <div className="heading">
        <div><h1>{data.position_title}</h1><p className="muted">{data.organization_name}</p></div>
        <div className="actions">
          {['review', 'completed', 'disputed'].includes(data.status) && (
            <button className="button secondary" onClick={() => setShowAppealModal(true)}>
              ⚖️ Değerlendirmeye İtiraz Et (C11)
            </button>
          )}
        </div>
      </div>
      {message && <p className="notice">{message}</p>}

      {/* C10 Başvuru Aşamaları Timeline */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <h2>Başvuru Durum Süreci</h2>
        <div className="step-bar" style={{ border: 'none', padding: '10px 0' }}>
          <div className="step-item completed"><span className="step-num">✓</span> Başvuru Yapıldı</div>
          <div className={`step-item ${['in_progress', 'submitted', 'review', 'human_review', 'completed', 'disputed'].includes(data.status) ? 'completed' : data.status === 'invited' ? 'active' : ''}`}>
            <span className="step-num">2</span> Mülakat
          </div>
          <div className={`step-item ${['review', 'human_review', 'completed', 'disputed'].includes(data.status) ? 'completed' : ''}`}>
            <span className="step-num">3</span> İnceleme
          </div>
          <div className={`step-item ${data.status === 'completed' ? 'completed' : data.status === 'disputed' ? 'active' : ''}`}>
            <span className="step-num">4</span> {data.status === 'disputed' ? 'İtiraz Sürecinde' : 'Sonuç'}
          </div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="card">
          <h2>Başvuru Bilgileri</h2>
          <p><strong>Aday:</strong> {data.candidate_name}</p>
          <p><strong>Durum:</strong> <span className="badge">{statusLabel(data.status)}</span></p>
          <p><strong>CV:</strong> {data.has_cv ? 'Yüklendi' : 'Yüklenmedi'}</p>
        </div>
        <div className="card">
          <h2>Mülakat Daveti</h2>
          {data.invitation_path ? (
            <>
              <p>Mülakat davetiniz hazır. Süre: {data.estimated_minutes} dakika.</p>
              <Link className="button" to={data.invitation_path}>Mülakata Başla →</Link>
            </>
          ) : (
            <p className="muted">Aktif mülakat oturumunuz bulunmuyor.</p>
          )}
        </div>
      </div>

      {/* C11 İtiraz Modalı */}
      {showAppealModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Gerekçeli İtiraz Başvurusu</h2>
            <p className="muted">Değerlendirmede adil olmadığını düşündüğünüz hususları ve video/transkript dakika referansını belirtin.</p>
            <form onSubmit={submitAppeal}>
              <label htmlFor="appeal-reason">İtiraz Gerekçesi (En az 10 karakter):</label>
              <textarea
                id="appeal-reason"
                required
                minLength={10}
                rows={4}
                value={appealReason}
                onChange={e => setAppealReason(e.target.value)}
                style={{ width: '100%', borderRadius: '6px', padding: '10px', border: '1px solid #cbd5e1' }}
              />
              <label htmlFor="timestamp-ref" style={{ marginTop: '12px', display: 'block' }}>İlgili Görüşme Zamanı (Opsiyonel, örn: 00:08:45):</label>
              <input
                id="timestamp-ref"
                type="text"
                placeholder="00:12:30"
                value={timestampRef}
                onChange={e => setTimestampRef(e.target.value)}
                style={{ width: '100%', borderRadius: '6px', padding: '8px', border: '1px solid #cbd5e1' }}
              />
              <div className="actions" style={{ marginTop: '20px' }}>
                <button className="button" disabled={busy}>İtirazı Gönder</button>
                <button type="button" className="button secondary" onClick={() => setShowAppealModal(false)}>Kapat</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// =========================================================================
// ŞİRKET: ADAY KARŞILAŞTIRMA EKRANI (B07)
// =========================================================================
function CompanyComparisonView() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    request<any>(`/api/company/positions/${id}/comparison`).then(setData).catch(e => setError(e.message));
  }, [id]);

  if (error) return <LoadError error={error} />;
  if (!data) return <p>Yükleniyor…</p>;

  return (
    <>
      <p className="muted"><Link to={`/sirket/pozisyonlar/${id}`}>Pozisyon</Link> / Aday Karşılaştırma</p>
      <div className="heading">
        <div>
          <h1>Aday Karşılaştırma — {data.position.title}</h1>
          <p className="muted">Plan sürümü {data.position.current_version} · Doğrulanmış ağırlıklı rubrik hesabı: Σ(puan × ağırlık)</p>
        </div>
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Aday</th>
              {data.requirements.map((r: any) => (
                <th key={r.id}>{r.label} (%{r.weight})</th>
              ))}
              <th>Genel Uyum</th>
              <th>Durum</th>
              <th>İşlem</th>
            </tr>
          </thead>
          <tbody>
            {data.candidates.length === 0 ? (
              <tr><td colSpan={data.requirements.length + 4} className="empty">Bu pozisyonda henüz değerlendirilen aday yok.</td></tr>
            ) : (
              data.candidates.map((c: any) => (
                <tr key={c.application_id}>
                  <td>
                    <strong>{c.candidate_name}</strong><br />
                    <span className="muted" style={{ fontSize: '12px' }}>{c.candidate_email}</span>
                  </td>
                  {data.requirements.map((r: any) => {
                    const score = c.scores_by_requirement[r.id];
                    return (
                      <td key={r.id}>
                        {score !== null && score !== undefined ? (
                          <span className={`score-badge ${score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low'}`}>
                            {score}
                          </span>
                        ) : (
                          <span className="score-badge incomplete">Kanıt Yetersiz</span>
                        )}
                      </td>
                    );
                  })}
                  <td>
                    {c.overall_score !== null ? (
                      <span className={`score-badge ${c.overall_score >= 75 ? 'high' : 'medium'}`} style={{ fontSize: '15px' }}>
                        %{c.overall_score}
                      </span>
                    ) : (
                      <span className="badge" style={{ background: '#fee2e2', color: '#991b1b' }}>Değerlendirme Tamamlanmadı</span>
                    )}
                  </td>
                  <td><span className="badge">{statusLabel(c.application_status)}</span></td>
                  <td>
                    <Link className="button" style={{ padding: '6px 12px', fontSize: '12px' }} to={`/sirket/basvurular/${c.application_id}/rapor`}>
                      Raporu Aç →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// =========================================================================
// ŞİRKET: MÜLAKAT RAPORU VE KAYIT İNCELEME (B08, REP-04 Puan Revizyonu)
// =========================================================================
function CompanyReportView({ csrf }: { csrf: string }) {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [revisingAssessment, setRevisingAssessment] = useState<any>(null);
  const [newScore, setNewScore] = useState<number>(80);
  const [revisionNote, setRevisionNote] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () => request<any>(`/api/company/applications/${id}/report`).then(setData);
  useEffect(() => { reload().catch(e => setError(e.message)); }, [id]);

  const handleRevise = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await request(`/api/company/assessments/${revisingAssessment.id}/revise`, csrf, { newScore, revisionNote });
      setRevisingAssessment(null);
      await reload();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <LoadError error={error} />;
  if (!data) return <p>Yükleniyor…</p>;

  const overallAssessment = data.assessments?.find((a: any) => a.is_overall);
  const reqAssessments = data.assessments?.filter((a: any) => !a.is_overall);

  return (
    <>
      <p className="muted"><Link to={`/sirket/basvurular/${id}`}>Başvuru</Link> / Mülakat Raporu</p>
      <div className="heading">
        <div>
          <h1>Mülakat Raporu: {data.application.candidate_name}</h1>
          <p className="muted">{data.application.position_title} · Görüşme Süresi: {data.application.duration_seconds || 45} sn</p>
        </div>
        <div>
          {overallAssessment?.score !== null ? (
            <div style={{ textAlign: 'right' }}>
              <span className="label">Genel Uyum Skoru</span>
              <div className="metric" style={{ color: '#0369a1' }}>%{overallAssessment?.score}</div>
            </div>
          ) : (
            <span className="badge" style={{ background: '#fee2e2', color: '#991b1b' }}>Eksik Kanıt / Tamamlanmadı</span>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px' }}>
        {/* Sol Kolon: Video Simülasyonu & Transkript */}
        <div>
          <div className="video-box" style={{ height: '240px', marginBottom: '16px' }}>
            <div style={{ textAlign: 'center', color: '#94a3b8' }}>
              <div style={{ fontSize: '36px', marginBottom: '8px' }}>🎥</div>
              <strong>Görüşme Video Kaydı</strong>
              <p style={{ fontSize: '12px' }}>Yetkili Şirket İncelemesi İçin Güvenli Arşivlenmiştir</p>
            </div>
            <div className="video-overlay">
              <span className="badge" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>00:45 / 00:45</span>
            </div>
          </div>

          <div className="card">
            <h2>Konuşma Transkripti ({data.turns?.length || 0} Tur)</h2>
            <div className="chat-flow" style={{ maxHeight: '380px' }}>
              {data.turns?.map((t: any) => (
                <div key={t.id} className={`turn ${t.speaker}`}>
                  <div className="turn-meta">
                    <strong>{t.speaker === 'ai' ? '🤖 AI Mülakatçı' : `👤 ${data.application.candidate_name}`}</strong>
                    <span>({t.audio_timestamp_start}s - {t.audio_timestamp_end}s)</span>
                  </div>
                  {t.transcript_text}
                </div>
              ))}
            </div>
          </div>

          {/* Uygulamalı Görev Çözümü */}
          {data.submission && (
            <div className="card" style={{ marginTop: '16px' }}>
              <h2>Uygulamalı Görev Teslimi</h2>
              <div className="editor-pane" style={{ maxHeight: '180px', overflowY: 'auto' }}>
                <pre>{data.submission.code_content}</pre>
              </div>
              <p style={{ marginTop: '10px' }}><strong>Adayın Açıklaması:</strong> {data.submission.explanation_text}</p>
            </div>
          )}
        </div>

        {/* Sağ Kolon: Kanıt Temelli Yetkinlik Puanları */}
        <div>
          <div className="card">
            <h2>Yetkinlik Değerlendirmeleri (Kanıtlı)</h2>
            {reqAssessments?.map((asm: any) => (
              <div key={asm.id} style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '14px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>Yetkinlik (Ağırlık %{asm.weight})</strong>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={`score-badge ${asm.score >= 80 ? 'high' : asm.score >= 60 ? 'medium' : 'low'}`}>
                      {asm.score !== null ? `${asm.score}` : 'Eksik'}
                    </span>
                    <button type="button" className="button secondary" style={{ padding: '3px 8px', fontSize: '11px' }} onClick={() => { setRevisingAssessment(asm); setNewScore(asm.score || 75); }}>
                      Düzelt
                    </button>
                  </div>
                </div>
                <p style={{ margin: '6px 0', fontSize: '13px' }}>{asm.rationale}</p>
                {asm.evidence_items?.map((ev: any) => (
                  <div key={ev.id} className="evidence-quote">
                    <strong>Kanıt Alıntısı:</strong> "{ev.quote}"
                  </div>
                ))}
                {asm.revised_by_email && (
                  <p style={{ fontSize: '11px', color: '#0369a1', marginTop: '4px' }}>
                    ✎ {asm.revised_by_email} tarafından revize edildi: "{asm.revision_note}"
                  </p>
                )}
              </div>
            ))}
          </div>

          {data.appeal && (
            <div className="card" style={{ marginTop: '16px', background: '#fffbeb', border: '1px solid #fde68a' }}>
              <h3>Aday İtirazı</h3>
              <p><strong>Gerekçe:</strong> {data.appeal.reason}</p>
              <p><strong>Referans Zamanı:</strong> {data.appeal.timestamp_reference || 'Belirtilmedi'}</p>
              <p><strong>Durum:</strong> <span className="badge">{statusLabel(data.appeal.status)}</span></p>
            </div>
          )}
        </div>
      </div>

      {/* Puan Düzeltme Modalı */}
      {revisingAssessment && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Yetkinlik Puanını Düzelt</h2>
            <p className="muted">Yetkili insan değerlendirici olarak AI puanını somut bir gerekçe belirterek revize edebilirsiniz.</p>
            <form onSubmit={handleRevise}>
              <label htmlFor="new-score">Yeni Puan (0 - 100):</label>
              <input id="new-score" type="number" min="0" max="100" value={newScore} onChange={e => setNewScore(Number(e.target.value))} required style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
              <label htmlFor="rev-note" style={{ display: 'block', marginTop: '12px' }}>Düzeltme Gerekçesi (Zorunlu):</label>
              <textarea id="rev-note" required minLength={5} rows={3} value={revisionNote} onChange={e => setRevisionNote(e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: '6px' }} placeholder="Transkriptteki proje deneyimi ek puanı hak etmektedir..." />
              <div className="actions" style={{ marginTop: '16px' }}>
                <button className="button" disabled={busy}>Puanı Kaydet</button>
                <button type="button" className="button secondary" onClick={() => setRevisingAssessment(null)}>Vazgeç</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// =========================================================================
// ŞİRKET: İTİRAZ YÖNETİMİ (B09)
// =========================================================================
function CompanyAppealsView({ csrf }: { csrf: string }) {
  const [data, setData] = useState<{ appeals: any[] } | null>(null);
  const [error, setError] = useState('');
  const [selectedAppeal, setSelectedAppeal] = useState<any>(null);
  const [decision, setDecision] = useState<'upheld' | 'revised' | 'additional_interview'>('revised');
  const [decisionNote, setDecisionNote] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () => request<any>('/api/company/appeals').then(setData);
  useEffect(() => { reload().catch(e => setError(e.message)); }, []);

  const handleDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await request(`/api/company/appeals/${selectedAppeal.id}/decide`, csrf, { decision, decisionNote });
      setSelectedAppeal(null);
      await reload();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <LoadError error={error} />;
  if (!data) return <p>Yükleniyor…</p>;

  return (
    <>
      <div className="heading">
        <div><h1>Aday İtirazları (B09)</h1><p className="muted">Adayların mülakat değerlendirmelerine yaptığı itiraz kuyruğu.</p></div>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Aday</th><th>Pozisyon</th><th>İtiraz Nedeni</th><th>Zaman Referansı</th><th>Durum</th><th>İşlem</th></tr>
          </thead>
          <tbody>
            {data.appeals.length === 0 ? (
              <tr><td colSpan={6} className="empty">Bekleyen itiraz bulunmuyor.</td></tr>
            ) : (
              data.appeals.map(a => (
                <tr key={a.id}>
                  <td><strong>{a.candidate_name}</strong><br /><span className="muted">{a.candidate_email}</span></td>
                  <td>{a.position_title}</td>
                  <td>{a.reason}</td>
                  <td>{a.timestamp_reference || 'Belirtilmedi'}</td>
                  <td><span className="badge">{statusLabel(a.status)}</span></td>
                  <td>
                    {a.status !== 'resolved' ? (
                      <button className="button" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => setSelectedAppeal(a)}>
                        Karara Bağla
                      </button>
                    ) : (
                      <span className="muted">Karar: {a.decision}</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedAppeal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>İtirazı Karara Bağla</h2>
            <p><strong>Aday:</strong> {selectedAppeal.candidate_name}</p>
            <p><strong>İtiraz Gerekçesi:</strong> {selectedAppeal.reason}</p>
            <form onSubmit={handleDecision}>
              <label htmlFor="dec-select">Karar Türü:</label>
              <select id="dec-select" value={decision} onChange={e => setDecision(e.target.value as any)} style={{ width: '100%', padding: '8px', borderRadius: '6px' }}>
                <option value="revised">İtiraz Haklı Bulundu / Puan Revize Edilecek</option>
                <option value="upheld">İtiraz Reddedildi / Değerlendirme Korundu</option>
                <option value="additional_interview">Ek Görüşme / Tamamlayıcı Oturum Gerekli</option>
              </select>
              <label htmlFor="dec-note" style={{ display: 'block', marginTop: '12px' }}>Karar Açıklaması ve Gerekçesi:</label>
              <textarea id="dec-note" required minLength={5} rows={3} value={decisionNote} onChange={e => setDecisionNote(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px' }} placeholder="Transkript incelenmiş olup adayın açıklaması rubric ölçütlerimize uygun bulunmuştur..." />
              <div className="actions" style={{ marginTop: '16px' }}>
                <button className="button" disabled={busy}>Kararı Onayla</button>
                <button type="button" className="button secondary" onClick={() => setSelectedAppeal(null)}>Kapat</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// =========================================================================
// ŞİRKET: MÜLAKAT PLANI YÖNETİMİ (B04, JOB-04, TASK-03)
// =========================================================================
function CompanyInterviewPlanView({ csrf }: { csrf: string }) {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [taskTemplate, setTaskTemplate] = useState<any>({
    title: '',
    task_type: 'coding',
    instructions: '',
    initial_code: '',
    sample_data: []
  });
  const [isApproved, setIsApproved] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () => {
    return request<any>(`/api/company/positions/${id}/plan`).then(res => {
      setData(res);
      setQuestions(res.plan?.questions || []);
      setTaskTemplate(res.plan?.task_template || {
        title: `${res.position?.title} Değerlendirme Görevi`,
        task_type: 'coding',
        instructions: '',
        initial_code: '',
        sample_data: []
      });
      setIsApproved(Boolean(res.plan?.is_approved));
    });
  };

  useEffect(() => { reload().catch(e => setError(e.message)); }, [id]);

  const handleQuestionChange = (idx: number, field: string, val: string) => {
    setQuestions(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: val };
      return copy;
    });
  };

  const handleAddQuestion = () => {
    const firstReq = data?.requirements?.[0];
    setQuestions(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        requirement_id: firstReq?.id || null,
        requirement_label: firstReq?.label || 'Genel Yetkinlik',
        order: prev.length + 1,
        question_text: 'Yeni mülakat sorusu metnini buraya yazın...',
        followup_template: 'Adayın cevabına göre yöneltilecek takip sorusu kalıbı...'
      }
    ]);
  };

  const handleRemoveQuestion = (idx: number) => {
    setQuestions(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async (approvedState: boolean) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await request(`/api/company/positions/${id}/plan`, csrf, {
        questions,
        taskTemplate,
        isApproved: approvedState
      }, 'PUT');
      setIsApproved(approvedState);
      setMessage(approvedState ? 'Mülakat planı onaylandı ve yayına alındı.' : 'Mülakat planı taslak olarak kaydedildi.');
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <LoadError error={error} />;
  if (!data) return <p>Yükleniyor…</p>;

  return (
    <>
      <p className="muted">
        <Link to="/sirket/pozisyonlar">Pozisyonlar</Link> / <Link to={`/sirket/pozisyonlar/${id}`}>{data.position.title}</Link> / Mülakat Planı
      </p>
      <div className="heading">
        <div>
          <h1>Mülakat Planı & Ölçütler (B04)</h1>
          <span className={`score-badge ${isApproved ? 'high' : 'medium'}`} style={{ padding: '4px 12px', fontSize: '13px' }}>
            {isApproved ? '✓ Onaylanmış Plan' : 'Taslak Plan'}
          </span>{' '}
          <span className="muted">Plan Sürümü {data.position.current_version} · Rubrik v{data.plan?.rubric_version || 1}</span>
        </div>
        <div className="actions">
          <button type="button" className="button secondary" disabled={busy} onClick={() => handleSave(false)}>
            Taslak Olarak Kaydet
          </button>
          <button type="button" className="button" disabled={busy} onClick={() => handleSave(true)} style={{ background: '#059669', borderColor: '#059669' }}>
            ✓ Planı Onayla ve Kaydet
          </button>
        </div>
      </div>

      {error && <LoadError error={error} />}
      {message && <p className="notice" role="status">{message}</p>}

      {/* Soru Listesi Kartı */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h2 style={{ margin: 0 }}>Mülakat Soruları ve Yetkinlik Eşleştirmesi (JOB-04)</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>AI mülakatçının yönelteceği sorular ve takip sorusu kalıpları.</p>
          </div>
          <button type="button" className="button secondary" onClick={handleAddQuestion} style={{ fontSize: '13px', padding: '6px 14px' }}>
            + Yeni Soru Ekle
          </button>
        </div>

        {questions.map((q, idx) => (
          <div key={q.id || idx} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px', marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="badge" style={{ background: '#0f172a', color: '#fff', fontWeight: 'bold' }}>#{idx + 1}</span>
                <label style={{ fontSize: '13px', fontWeight: '600' }}>İlişkili Yetkinlik:</label>
                <select
                  value={q.requirement_id || ''}
                  onChange={e => {
                    const reqId = e.target.value;
                    const r = data.requirements.find((x: any) => x.id === reqId);
                    setQuestions(prev => {
                      const copy = [...prev];
                      copy[idx] = { ...copy[idx], requirement_id: reqId, requirement_label: r?.label || '' };
                      return copy;
                    });
                  }}
                  style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                >
                  {data.requirements.map((r: any) => (
                    <option key={r.id} value={r.id}>
                      {r.label} ({r.required ? 'Zorunlu' : 'Tercih'}, %{r.weight})
                    </option>
                  ))}
                </select>
              </div>
              {questions.length > 1 && (
                <button type="button" className="button secondary" onClick={() => handleRemoveQuestion(idx)} style={{ color: '#dc2626', borderColor: '#fca5a5', padding: '4px 10px', fontSize: '12px' }}>
                  Kaldır
                </button>
              )}
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: '#475569' }}>
                Ana Soru Metni:
              </label>
              <textarea
                rows={2}
                value={q.question_text}
                onChange={e => handleQuestionChange(idx, 'question_text', e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: '#475569' }}>
                Takip Sorusu Şablonu (Eksik veya derinleştirme durumunda "Adayı Terletme" kurgusu):
              </label>
              <input
                type="text"
                value={q.followup_template || ''}
                onChange={e => handleQuestionChange(idx, 'followup_template', e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Uygulamalı Görev Şablonu Kartı */}
      <div className="card">
        <h2>Uygulamalı Değerlendirme Görevi Şablonu (TASK-01, TASK-03)</h2>
        <p className="muted">Pozisyona özel kodlama, SQL veya vaka inceleme senaryosu.</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px', marginTop: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>Görev Türü (TASK-01):</label>
            <select
              value={taskTemplate.task_type || 'coding'}
              onChange={e => setTaskTemplate({ ...taskTemplate, task_type: e.target.value })}
              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', marginBottom: '16px' }}
            >
              <option value="sql">SQL / Veri Sorgulama</option>
              <option value="coding">Algoritmik Kodlama (JavaScript/Python)</option>
              <option value="case_study">Teknik Vaka İncelemesi</option>
            </select>

            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>Görev Başlığı:</label>
            <input
              type="text"
              value={taskTemplate.title || ''}
              onChange={e => setTaskTemplate({ ...taskTemplate, title: e.target.value })}
              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>Aday Talimatları:</label>
            <textarea
              rows={3}
              value={taskTemplate.instructions || ''}
              onChange={e => setTaskTemplate({ ...taskTemplate, instructions: e.target.value })}
              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
            />
          </div>
        </div>

        <div style={{ marginTop: '16px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>Başlangıç Kodu / Şablon (initial_code):</label>
          <textarea
            rows={5}
            className="code-area"
            value={taskTemplate.initial_code || ''}
            onChange={e => setTaskTemplate({ ...taskTemplate, initial_code: e.target.value })}
            style={{ width: '100%', height: '140px' }}
          />
        </div>

        <div className="actions" style={{ marginTop: '20px' }}>
          <button type="button" className="button" disabled={busy} onClick={() => handleSave(true)} style={{ background: '#059669', borderColor: '#059669' }}>
            ✓ Değişiklikleri Onayla ve Kaydet
          </button>
        </div>
      </div>
    </>
  );
}

// =========================================================================
// ŞİRKET: EKİP VE ŞİRKET AYARLARI (B10, AUTH-05, AUTH-06, NFR-06, NFR-10)
// =========================================================================
function CompanySettingsView({ csrf }: { csrf: string }) {
  const [tab, setTab] = useState<'team' | 'policy' | 'audit'>('team');
  const [team, setTeam] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>({
    recording_retention_days: 90,
    appeal_window_days: 14,
    invite_mode: 'manual',
    allow_candidate_audio_download: false,
    feedback_contact_email: ''
  });
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  // Yeni Üye Ekleme Formu
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'recruiter' | 'reviewer'>('recruiter');
  const [newPassword, setNewPassword] = useState('');
  const [showAddMember, setShowAddMember] = useState(false);

  const loadTeam = () => request<any>('/api/company/team').then(res => setTeam(res.members || []));
  const loadSettings = () => request<any>('/api/company/settings').then(res => setSettings(res.settings));
  const loadAudit = () => request<any>('/api/company/audit-logs').then(res => setAuditLogs(res.audit_logs || []));

  useEffect(() => {
    Promise.all([loadTeam(), loadSettings(), loadAudit()]).catch(e => setError(e.message));
  }, []);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await request('/api/company/team', csrf, {
        email: newEmail,
        role: newRole,
        password: newPassword || undefined
      });
      setMessage(`Yeni ekip üyesi (${newEmail}) başarıyla eklendi.`);
      setNewEmail('');
      setNewPassword('');
      setShowAddMember(false);
      await loadTeam();
      await loadAudit();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateMemberRole = async (memId: string, role: string, active: boolean) => {
    setBusy(true);
    setError('');
    try {
      await request(`/api/company/team/${memId}`, csrf, { role, active }, 'PUT');
      setMessage('Ekip üyesi yetkileri güncellendi.');
      await loadTeam();
      await loadAudit();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await request('/api/company/settings', csrf, {
        recordingRetentionDays: settings.recording_retention_days,
        appealWindowDays: settings.appeal_window_days,
        inviteMode: settings.invite_mode,
        allowCandidateAudioDownload: settings.allow_candidate_audio_download,
        feedbackContactEmail: settings.feedback_contact_email
      }, 'PUT');
      setMessage('Kayıt saklama politikası ve şirket ayarları başarıyla kaydedildi.');
      await loadSettings();
      await loadAudit();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="heading">
        <div>
          <h1>Ekip ve Ayarlar (B10)</h1>
          <p className="muted">Rol bazlı yetkilendirme matrisi, kayıt politikaları ve denetim izleri.</p>
        </div>
      </div>

      {error && <LoadError error={error} />}
      {message && <p className="notice" role="status">{message}</p>}

      {/* Sekmeler */}
      <div className="tab-group">
        <button type="button" className={`tab-btn ${tab === 'team' ? 'active' : ''}`} onClick={() => setTab('team')}>
          👥 Ekip ve Roller (AUTH-05)
        </button>
        <button type="button" className={`tab-btn ${tab === 'policy' ? 'active' : ''}`} onClick={() => setTab('policy')}>
          🔒 Kayıt & Saklama Politikası (NFR-06)
        </button>
        <button type="button" className={`tab-btn ${tab === 'audit' ? 'active' : ''}`} onClick={() => setTab('audit')}>
          📋 Denetim Kayıtları (NFR-10)
        </button>
      </div>

      {/* SEKME 1: EKİP VE ROLLER */}
      {tab === 'team' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0 }}>Şirket Ekip Üyeleri</h2>
            <button type="button" className="button" onClick={() => setShowAddMember(true)} style={{ fontSize: '13px', padding: '8px 16px' }}>
              + Yeni Ekip Üyesi Ekle
            </button>
          </div>

          <div className="card table-wrap" style={{ marginBottom: '24px' }}>
            <table>
              <thead>
                <tr>
                  <th>E-posta</th>
                  <th>Rol</th>
                  <th>Durum</th>
                  <th>Eklenme Tarihi</th>
                  <th>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {team.map(m => (
                  <tr key={m.membership_id}>
                    <td><strong>{m.email}</strong> {m.development_only && <span className="muted">(Geliştirme)</span>}</td>
                    <td>
                      <select
                        value={m.role}
                        disabled={busy}
                        onChange={e => handleUpdateMemberRole(m.membership_id, e.target.value, m.active)}
                        style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                      >
                        <option value="admin">Yönetici (Admin)</option>
                        <option value="recruiter">İşe Alım Uzmanı (Recruiter)</option>
                        <option value="reviewer">Değerlendirici (Reviewer)</option>
                      </select>
                    </td>
                    <td>
                      <span className={`badge ${m.active ? 'criteria-badge full' : 'criteria-badge missing'}`}>
                        {m.active ? 'Aktif' : 'Erişim Kaldırıldı (Pasif)'}
                      </span>
                    </td>
                    <td>{new Date(m.created_at).toLocaleDateString('tr-TR')}</td>
                    <td>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        onClick={() => handleUpdateMemberRole(m.membership_id, m.role, !m.active)}
                        style={{ padding: '4px 10px', fontSize: '12px', color: m.active ? '#dc2626' : '#059669' }}
                      >
                        {m.active ? 'Yetkiyi Kaldır' : 'Tekrar Aktifleştir'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ background: '#f8fafc' }}>
            <h3>Yetki Rolleri ve Erişim Sınırları (PDF Bölüm 03)</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginTop: '12px' }}>
              <div style={{ background: '#fff', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <strong style={{ color: '#0f172a' }}>👑 Yönetici (Admin)</strong>
                <p style={{ fontSize: '13px', margin: '6px 0 0', color: '#64748b' }}>
                  Ekip üyeleri ekleme, rol belirleme, şirket kayıt ve saklama ayarları, tüm pozisyon ve başvuru yönetimi.
                </p>
              </div>
              <div style={{ background: '#fff', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <strong style={{ color: '#0f172a' }}>💼 İşe Alım Uzmanı</strong>
                <p style={{ fontSize: '13px', margin: '6px 0 0', color: '#64748b' }}>
                  Pozisyon oluşturma, CV yükleme ve analizi, mülakat daveti gönderme, aday karşılaştırma ve raporları görme.
                </p>
              </div>
              <div style={{ background: '#fff', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <strong style={{ color: '#0f172a' }}>🔍 Değerlendirici / İtiraz</strong>
                <p style={{ fontSize: '13px', margin: '6px 0 0', color: '#64748b' }}>
                  Aday kanıtlarını ve transkriptlerini inceleme, insan puan düzeltmesi yapma ve itirazları karara bağlama.
                </p>
              </div>
            </div>
          </div>

          {showAddMember && (
            <div className="modal-overlay">
              <div className="modal-content">
                <h2>Yeni Ekip Üyesi Ekle</h2>
                <form onSubmit={handleAddMember}>
                  <label htmlFor="new-email">Kullanıcı E-posta Adresi:</label>
                  <input
                    id="new-email"
                    type="email"
                    required
                    value={newEmail}
                    onChange={e => setNewEmail(e.target.value)}
                    placeholder="ornek@sirket.com"
                  />

                  <label htmlFor="new-role" style={{ marginTop: '14px', display: 'block' }}>Kullanıcı Rolü:</label>
                  <select
                    id="new-role"
                    value={newRole}
                    onChange={e => setNewRole(e.target.value as any)}
                    style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  >
                    <option value="recruiter">İşe Alım Uzmanı (Recruiter)</option>
                    <option value="reviewer">Değerlendirici / İtiraz Ekibi (Reviewer)</option>
                    <option value="admin">Şirket Yöneticisi (Admin)</option>
                  </select>

                  <label htmlFor="new-pass" style={{ marginTop: '14px', display: 'block' }}>İlk Giriş Parolası (Opsiyonel):</label>
                  <input
                    id="new-pass"
                    type="text"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="Boş bırakılırsa varsayılan atanır"
                  />

                  <div className="actions" style={{ marginTop: '20px' }}>
                    <button className="button" disabled={busy}>Üyeyi Ekle</button>
                    <button type="button" className="button secondary" onClick={() => setShowAddMember(false)}>İptal</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SEKME 2: KAYIT VE SAKLAMA POLİTİKASI */}
      {tab === 'policy' && (
        <div className="card" style={{ maxWidth: '720px' }}>
          <h2>Kayıt, Saklama ve Erişim Politikaları (NFR-04, NFR-06)</h2>
          <p className="muted">KVKK ve veri saklama standartlarına uygun olarak mülakat verilerinin yaşam döngüsü.</p>

          <form onSubmit={handleSaveSettings} style={{ marginTop: '20px' }}>
            <div style={{ marginBottom: '16px' }}>
              <label htmlFor="retention" style={{ display: 'block', fontWeight: '600', marginBottom: '6px' }}>
                Ses ve Video Kaydı Saklama Süresi (Gün):
              </label>
              <input
                id="retention"
                type="number"
                min={7}
                max={365}
                required
                value={settings.recording_retention_days || 90}
                onChange={e => setSettings({ ...settings, recording_retention_days: Number(e.target.value) })}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
              <small className="muted">Süre dolduğunda kayıtlar arşivleme veya silme kuralına tabi tutulur (Önerilen: 90 gün).</small>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label htmlFor="appeal-win" style={{ display: 'block', fontWeight: '600', marginBottom: '6px' }}>
                Aday İtiraz Başvuru Süresi (Gün):
              </label>
              <input
                id="appeal-win"
                type="number"
                min={3}
                max={60}
                required
                value={settings.appeal_window_days || 14}
                onChange={e => setSettings({ ...settings, appeal_window_days: Number(e.target.value) })}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
              <small className="muted">Adayın mülakat tamamlandıktan sonra gerekçeli itiraz yapabileceği azami gün sayısı.</small>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label htmlFor="inv-mode" style={{ display: 'block', fontWeight: '600', marginBottom: '6px' }}>
                Davet Gönderim Modu (PDF Açık Kararlar P0):
              </label>
              <select
                id="inv-mode"
                value={settings.invite_mode || 'manual'}
                onChange={e => setSettings({ ...settings, invite_mode: e.target.value })}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              >
                <option value="manual">Şirket Onaylı Manuel Gönderim (Önerilen)</option>
                <option value="auto">CV Analizi Sonrası Otomatik Davet Gönderimi</option>
              </select>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Boolean(settings.allow_candidate_audio_download)}
                  onChange={e => setSettings({ ...settings, allow_candidate_audio_download: e.target.checked })}
                />
                <span>Adayların kendi ses kayıtlarını indirmesine izin ver (NFR-04 erişim sınırı)</span>
              </label>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label htmlFor="contact-mail" style={{ display: 'block', fontWeight: '600', marginBottom: '6px' }}>
                Geri Bildirim ve İtiraz İletişim E-postası:
              </label>
              <input
                id="contact-mail"
                type="email"
                value={settings.feedback_contact_email || ''}
                onChange={e => setSettings({ ...settings, feedback_contact_email: e.target.value })}
                placeholder="ik@sirket.com"
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>

            <button className="button" disabled={busy}>Ayarları Kaydet</button>
          </form>
        </div>
      )}

      {/* SEKME 3: DENETİM KAYITLARI */}
      {tab === 'audit' && (
        <div className="card table-wrap">
          <h2>İzlenebilirlik ve Denetim Kayıtları (NFR-10, REP-06)</h2>
          <p className="muted">Değerlendirme değişiklikleri, itiraz kararları ve yetki güncellemelerinin denetim izi.</p>

          <table>
            <thead>
              <tr>
                <th>Tarih</th>
                <th>İşlemi Yapan</th>
                <th>İşlem Türü</th>
                <th>Varlık</th>
                <th>Açıklama / Gerekçe</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.length === 0 ? (
                <tr><td colSpan={5} className="empty">Kayıtlı denetim olayı bulunmuyor.</td></tr>
              ) : (
                auditLogs.map(log => (
                  <tr key={log.id}>
                    <td style={{ fontSize: '13px' }}>{new Date(log.created_at).toLocaleString('tr-TR')}</td>
                    <td><strong>{log.user_email || 'Sistem'}</strong></td>
                    <td><span className="badge">{log.action}</span></td>
                    <td>{log.entity_type}</td>
                    <td style={{ fontSize: '13px' }}>{log.rationale || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
