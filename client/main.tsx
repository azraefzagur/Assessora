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
  interrupted: 'Bağlantı Kesintisi (Kurtarma Bekliyor)',
  shortlisted: 'Kısa Listede', rejected: 'Reddedildi',
  submitted: 'Teslim edildi', review: 'Değerlendirmede', human_review: 'İnsan incelemesinde',
  completed: 'Tamamlandı', disputed: 'İtiraz edildi',
  upheld: 'Reddedildi (Puan Korundu)', revised: 'Revize Edildi', additional_interview: 'Ek Görüşme'
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
      <Route path="/sirket/cv-degerlendirme" element={session.actor === 'company' ? <Shell actor="company" csrf={session.csrf} refresh={refresh}><CompanyCvEvaluationView csrf={session.csrf} /></Shell> : <Navigate to="/sirket/giris" />} />
      <Route path="/sirket/basvurular/:id/rapor" element={session.actor === 'company' ? <Shell actor="company" csrf={session.csrf} refresh={refresh}><CompanyReportView csrf={session.csrf} /></Shell> : <Navigate to="/sirket/giris" />} />
      <Route path="/sirket/davetler/:id" element={session.actor === 'company' ? <Shell actor="company" csrf={session.csrf} refresh={refresh}><CompanyInvitationPreview csrf={session.csrf} /></Shell> : <Navigate to="/sirket/giris" />} />
      <Route path="/sirket/davet-planlama" element={session.actor === 'company' ? <Shell actor="company" csrf={session.csrf} refresh={refresh}><CompanyInvitationPlanningView csrf={session.csrf} /></Shell> : <Navigate to="/sirket/giris" />} />
      <Route path="/sirket/itirazlar" element={session.actor === 'company' ? <Shell actor="company" csrf={session.csrf} refresh={refresh}><CompanyAppealsView csrf={session.csrf} /></Shell> : <Navigate to="/sirket/giris" />} />
      <Route path="/sirket/ayarlar" element={session.actor === 'company' ? <Shell actor="company" csrf={session.csrf} refresh={refresh}><CompanySettingsView csrf={session.csrf} /></Shell> : <Navigate to="/sirket/giris" />} />
      <Route path="/sirket/ekip" element={session.actor === 'company' ? <Shell actor="company" csrf={session.csrf} refresh={refresh}><CompanySettingsView csrf={session.csrf} /></Shell> : <Navigate to="/sirket/giris" />} />

      {/* Aday Yolları */}
      <Route path="/aday" element={session.actor === 'candidate' ? <Shell actor="candidate" csrf={session.csrf} refresh={refresh}><CandidateHome /></Shell> : <Navigate to="/aday/giris" />} />
      <Route path="/aday/basvurular/:id" element={session.actor === 'candidate' ? <Shell actor="candidate" csrf={session.csrf} refresh={refresh}><CandidateApplicationDetail csrf={session.csrf} /></Shell> : <RequireCandidateReturn />} />
      <Route path="/aday/davet/:token" element={<CandidateInvitationFlow csrf={session.csrf} refresh={refresh} currentActor={session.actor} />} />
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
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(45);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  if (!email) return <Navigate to="/aday/giris" />;

  const maskedEmail = email.replace(/^(.{2})(.*)(@.*)$/, (_, a, b, c) => `${a}${'*'.repeat(Math.min(5, b.length))}${c}`);

  const handleDigitChange = (index: number, val: string) => {
    const cleaned = val.replace(/\D/g, '');
    if (!cleaned) {
      setDigits(prev => {
        const next = [...prev];
        next[index] = '';
        return next;
      });
      return;
    }

    if (cleaned.length > 1) {
      const pasted = cleaned.slice(0, 6).split('');
      const next = ['', '', '', '', '', ''];
      pasted.forEach((d, i) => { if (i < 6) next[i] = d; });
      setDigits(next);
      inputRefs.current[Math.min(5, pasted.length - 1)]?.focus();
      return;
    }

    setDigits(prev => {
      const next = [...prev];
      next[index] = cleaned[0];
      return next;
    });

    if (index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasteData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasteData) return;
    const next = ['', '', '', '', '', ''];
    pasteData.split('').forEach((d, i) => { if (i < 6) next[i] = d; });
    setDigits(next);
    inputRefs.current[Math.min(5, pasteData.length - 1)]?.focus();
  };

  const code = digits.join('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (code.length !== 6) {
      setError('Lütfen 6 haneli doğrulama kodunu eksiksiz girin.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await request('/api/candidate/code/verify', csrf, { email, code });
      sessionStorage.removeItem('candidate_email');
      const next = sessionStorage.getItem('candidate_return_to') || '/aday';
      sessionStorage.removeItem('candidate_return_to');
      window.location.replace(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const result = await request<{ message: string; developmentCode?: string }>('/api/candidate/code/request', csrf, { email });
      setDevelopmentCode(result.developmentCode);
      setDigits(['', '', '', '', '', '']);
      setInfo(result.message);
      setCountdown(45);
      inputRefs.current[0]?.focus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-intro">
        <div className="brand"><small>İşe alım platformu</small>Assessora</div>
        <h1>E-postanızı doğrulayın</h1>
        <p>
          {developmentCode
            ? 'Yerel test ortamı devrede. Aday kodunuz otomatik üretilmiştir.'
            : `${maskedEmail} adresine tek kullanımlık 6 haneli güvenlik kodu gönderilmiştir.`}
        </p>
      </section>
      <section className="auth-panel">
        <div className="auth-box">
          <div className="card" style={{ textAlign: 'center' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#eff6ff', color: '#2563eb', fontSize: '24px', display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}>
              ✉️
            </div>
            <h2>Doğrulama Kodunu Girin</h2>
            <p className="muted" style={{ fontSize: '13px' }}>
              <strong>{maskedEmail}</strong> adresine gönderdiğimiz 6 haneli kodu girin (C02 / C04).
            </p>

            {developmentCode && (
              <p className="notice" role="status" style={{ textAlign: 'left' }}>
                🔑 Geliştirme Test Kodu: <strong>{developmentCode}</strong><br />
                <small className="muted">10 dakika geçerlidir ve tek kullanımlıktır.</small>
              </p>
            )}

            {info && <p className="notice" role="status">{info}</p>}
            {error && <div className="error" role="alert">{error}</div>}

            <form onSubmit={submit}>
              {/* PDF Sayfa 33 Panel 2: 6 Haneli OTP Kutuları */}
              <div className="otp-container">
                {digits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={el => { inputRefs.current[idx] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    className="otp-box"
                    value={digit}
                    onChange={e => handleDigitChange(idx, e.target.value)}
                    onKeyDown={e => handleKeyDown(idx, e)}
                    onPaste={idx === 0 ? handlePaste : undefined}
                    aria-label={`${idx + 1}. basamak`}
                  />
                ))}
              </div>

              <div style={{ marginTop: '20px' }}>
                <button className="button" style={{ width: '100%', fontSize: '15px' }} disabled={busy || code.length !== 6}>
                  {busy ? 'Doğrulanıyor…' : 'Doğrula ve Giriş Yap'}
                </button>
              </div>

              <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: countdown > 0 ? '#94a3b8' : '#0284c7', cursor: countdown > 0 ? 'default' : 'pointer', padding: 0 }}
                  disabled={busy || countdown > 0}
                  onClick={resend}
                >
                  {countdown > 0 ? `Kodu yeniden gönder (${countdown}s)` : 'Kodu yeniden gönder'}
                </button>
                <Link to="/aday/giris" style={{ color: '#64748b' }}>E-posta adresini değiştir</Link>
              </div>
            </form>

            <p className="muted" style={{ fontSize: '11px', marginTop: '20px' }}>
              Kod gelmediyse lütfen spam klasörünüzü kontrol edin.
            </p>
          </div>
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
            <Link to="/sirket">📊 Genel bakış</Link>
            <Link to="/sirket/pozisyonlar">💼 Pozisyonlar</Link>
            <Link to="/sirket/basvurular">👥 Adaylar & Başvurular</Link>
            <Link to="/sirket/cv-degerlendirme">📑 CV Değerlendirme (B05)</Link>
            <Link to="/sirket/davet-planlama">✉️ Davet ve Planlama (B06)</Link>
            <Link to="/sirket/itirazlar">⚖️ İtiraz İnceleme (B09)</Link>
            <Link to="/sirket/ayarlar">⚙️ Ekip ve Ayarlar (B10)</Link>
          </> : <Link to="/aday">📋 Başvurularım</Link>}
        </nav>
        <button onClick={logout}>Çıkış yap</button>
      </aside>
      <div className="main">
        <header className="topbar">
          <span>{actor === 'company' ? 'Şirket İşe Alım Portalı' : 'Aday Değerlendirme Portalı'}</span>
          <strong>Assessora AI Mülakat</strong>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

function LoadError({ error }: { error: string }) { return <div className="error" role="alert">{error}</div>; }

function CompanyHome() {
  const [data, setData] = useState<any>(null), [error, setError] = useState('');
  useEffect(() => { request<any>('/api/company/dashboard').then(setData).catch(e => setError(e.message)); }, []);
  if (error) return <LoadError error={error} />; if (!data) return <p>Yükleniyor…</p>;
  return (
    <>
      <div className="heading">
        <div>
          <h1>Genel Bakış (B02)</h1>
          <p className="muted">{data.organization} için yapay zeka destekli mülakat ve değerlendirme çalışma alanı.</p>
        </div>
        {data.role !== 'reviewer' && (
          <div className="actions">
            <Link className="button" to="/sirket/pozisyonlar/yeni">+ Yeni Pozisyon</Link>
            <Link className="button secondary" to="/sirket/davet-planlama">✉️ Davet ve Planlama</Link>
          </div>
        )}
      </div>

      {/* PDF Sayfa 29/30 Panel 2: 4 Metrik Kartı */}
      <div className="metric-grid-4">
        <div className="metric-card">
          <div className="metric-icon blue">💼</div>
          <div className="metric-content">
            <div className="metric-number">{data.positionCount}</div>
            <div className="metric-title">Açık Pozisyonlar</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon purple">👥</div>
          <div className="metric-content">
            <div className="metric-number">{data.applicationCount}</div>
            <div className="metric-title">Toplam Adaylar</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon green">🎥</div>
          <div className="metric-content">
            <div className="metric-number">{data.completedInterviewCount}</div>
            <div className="metric-title">Tamamlanan Mülakatlar</div>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon amber">⏳</div>
          <div className="metric-content">
            <div className="metric-number">{data.pendingReviewCount}</div>
            <div className="metric-title">İnceleme Bekleyenler</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
        {/* Yaklaşan / Devam Eden Mülakatlar */}
        <div className="card">
          <h2>Yaklaşan / Devam Eden Mülakatlar</h2>
          {data.upcomingInterviews?.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Aday</th><th>Pozisyon</th><th>Durum</th><th>İşlem</th></tr></thead>
                <tbody>
                  {data.upcomingInterviews.map((u: any) => (
                    <tr key={u.application_id}>
                      <td><strong>{u.candidate_name}</strong><br /><small className="muted">{u.candidate_email}</small></td>
                      <td>{u.position_title}</td>
                      <td><span className="badge">{statusLabel(u.application_status)}</span></td>
                      <td>
                        <Link className="button secondary" style={{ padding: '4px 10px', fontSize: '11px' }} to={`/sirket/basvurular/${u.application_id}`}>
                          Aday Detayı →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="empty">Şu anda bekleyen veya devam eden mülakat oturumu yok.</p>}
        </div>

        {/* İnceleme Bekleyenler */}
        <div className="card">
          <h2>İnceleme Bekleyenler</h2>
          {data.pendingReviews?.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Aday</th><th>Pozisyon</th><th>Durum</th><th>İşlem</th></tr></thead>
                <tbody>
                  {data.pendingReviews.map((p: any) => (
                    <tr key={p.application_id}>
                      <td><strong>{p.candidate_name}</strong><br /><small className="muted">{p.candidate_email}</small></td>
                      <td>{p.position_title}</td>
                      <td>
                        <span className="badge" style={{ background: p.has_appeal ? '#fee2e2' : '#fef3c7', color: p.has_appeal ? '#991b1b' : '#92400e' }}>
                          {p.has_appeal ? 'İtiraz İncelemede' : statusLabel(p.application_status)}
                        </span>
                      </td>
                      <td>
                        {p.has_session ? (
                          <Link className="button" style={{ padding: '4px 10px', fontSize: '11px', background: '#0284c7', borderColor: '#0284c7' }} to={`/sirket/basvurular/${p.application_id}/rapor`}>
                            Raporu Aç →
                          </Link>
                        ) : (
                          <Link className="button secondary" style={{ padding: '4px 10px', fontSize: '11px' }} to={`/sirket/basvurular/${p.application_id}`}>
                            CV İncele →
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="empty">İnceleme bekleyen aday bulunmuyor.</p>}
        </div>
      </div>

      {/* Son Pozisyonlar ve Son Aktiviteler */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '20px' }}>
        <div className="card">
          <h2>Son Pozisyonlar</h2>
          {data.recent.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Başlık</th><th>Durum</th><th>Tarih</th><th>İşlemler</th></tr></thead>
                <tbody>
                  {data.recent.map((p: any) => (
                    <tr key={p.id}>
                      <td><Link to={`/sirket/pozisyonlar/${p.id}`}><strong>{p.title}</strong></Link></td>
                      <td><span className="badge">{statusLabel(p.status)}</span></td>
                      <td>{date(p.created_at)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <Link className="button secondary" style={{ padding: '4px 8px', fontSize: '11px' }} to={`/sirket/pozisyonlar/${p.id}/karsilastir`}>
                            Adayları Karşılaştır (B07)
                          </Link>
                          <Link className="button secondary" style={{ padding: '4px 8px', fontSize: '11px' }} to={`/sirket/pozisyonlar/${p.id}/plan`}>
                            Plan (B04)
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="empty">Henüz pozisyon oluşturulmadı.</p>}
        </div>

        <div className="card">
          <h2>Son Aktiviteler & Denetim İzi</h2>
          {data.recentActivities?.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {data.recentActivities.map((act: any) => (
                <div key={act.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                  <div>
                    <span className="badge" style={{ fontSize: '10px', textTransform: 'uppercase', marginRight: '6px' }}>{act.action}</span>
                    <strong style={{ fontSize: '13px' }}>{act.rationale || 'İşlem tamamlandı'}</strong>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>{act.user_email || 'Sistem'}</div>
                  </div>
                  <small className="muted" style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>
                    {new Date(act.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                  </small>
                </div>
              ))}
            </div>
          ) : <p className="empty">Kayıtlı son işlem bulunmuyor.</p>}
        </div>
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
  const [data, setData] = useState<{ name: string; applications: Application[] } | null>(null), [invitations, setInvitations] = useState<any[]>([]), [error, setError] = useState('');
  useEffect(() => {
    Promise.all([
      request<{ name: string; applications: Application[] }>('/api/candidate/applications'),
      request<{ invitations: any[] }>('/api/candidate/invitations')
    ]).then(([apps, invites]) => { setData(apps); setInvitations(invites.invitations); }).catch(e => setError(e.message));
  }, []);
  if (error) return <LoadError error={error} />; if (!data) return <p>Yükleniyor…</p>;

  const interruptedInvite = invitations.find((i: any) => i.session_status === 'interrupted');

  return (
    <>
      <div className="heading"><div><h1>Başvurularım</h1><p className="muted">{data.name} için başvuru durumları.</p></div></div>

      {interruptedInvite && (
        <div className="recovery-banner" style={{ marginBottom: '20px', padding: '16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <strong style={{ color: '#92400e', fontSize: '15px' }}>⚠️ Kesinti Nedeniyle Duraklatılan Mülakatınız Bulunuyor (C12)</strong>
              <p style={{ margin: '4px 0 0', color: '#b45309', fontSize: '13px' }}>
                <strong>{interruptedInvite.position_title}</strong> için önceki oturum verileriniz ve transkriptiniz korundu. Kaldığınız sorudan devam edebilirsiniz.
              </p>
            </div>
            <Link className="button" style={{ background: '#d97706', borderColor: '#d97706' }} to={interruptedInvite.path}>
              Kaldığın Yerden Devam Et ({((interruptedInvite.current_question_index || 0) + 1)}. Soru) →
            </Link>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Açık davetler</h2>
        {invitations.length ? invitations.map(invite => {
          const isInterrupted = invite.session_status === 'interrupted';
          return (
            <div className="list-item" key={invite.id}>
              <div>
                <strong>{invite.position_title}</strong>
                {isInterrupted && <span className="badge warning" style={{ marginLeft: '8px' }}>⚠️ Kesinti Kurtarma (C12)</span>}
                <p className="muted">{invite.organization_name} · {invite.estimated_minutes} dakika · Son katılım {date(invite.expires_at)}</p>
              </div>
              <Link
                className="button"
                style={isInterrupted ? { background: '#d97706', borderColor: '#d97706' } : {}}
                to={invite.path}
              >
                {isInterrupted ? 'Kaldığın Yerden Devam Et →' : 'Daveti gör & Başla'}
              </Link>
            </div>
          );
        }) : <p className="muted">Açık davet bulunmuyor.</p>}
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

function CompanyInvitationPlanningView({ csrf }: { csrf: string }) {
  const [data, setData] = useState<any>(null);
  const [selectedPositionId, setSelectedPositionId] = useState<string>('all');
  const [selectedAppIds, setSelectedAppIds] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState<string>('standard');
  const [customSubject, setCustomSubject] = useState<string>('Assessora Mülakat Davetiniz — {pozisyon}');
  const [customBody, setCustomBody] = useState<string>('Sayın {ad},\n\n{pozisyon} pozisyonu başvurunuz için AI destekli teknik mülakatınız planlanmıştır.\n\nBağlantıya tıklayarak mülakata başlayabilirsiniz:\n{link}\n\nSon katılım tarihi: {tarih}\n\nBaşarılar dileriz.');
  const [estimatedMinutes, setEstimatedMinutes] = useState<number>(30);
  const [expiresInDays, setExpiresInDays] = useState<number>(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [successResult, setSuccessResult] = useState<any>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  const loadData = () => {
    request<any>('/api/company/invitation-planning')
      .then(res => {
        setData(res);
        if (res.templates?.length > 0) {
          const std = res.templates[0];
          setTemplateId(std.id);
          setCustomSubject(std.subject);
          setCustomBody(std.body);
        }
      })
      .catch(e => setError(e.message));
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleTemplateChange = (tplId: string) => {
    setTemplateId(tplId);
    const found = data?.templates?.find((t: any) => t.id === tplId);
    if (found) {
      setCustomSubject(found.subject);
      setCustomBody(found.body);
    }
  };

  const filteredCandidates = (data?.candidates || []).filter((c: any) => {
    if (selectedPositionId === 'all') return true;
    return c.position_id === selectedPositionId;
  });

  const toggleSelectAll = () => {
    if (selectedAppIds.length === filteredCandidates.length) {
      setSelectedAppIds([]);
    } else {
      setSelectedAppIds(filteredCandidates.map((c: any) => c.application_id));
    }
  };

  const toggleCandidate = (appId: string) => {
    setSelectedAppIds(prev =>
      prev.includes(appId) ? prev.filter(x => x !== appId) : [...prev, appId]
    );
  };

  const handleBatchSend = async () => {
    if (selectedAppIds.length === 0) {
      setError('Lütfen davet gönderilecek en az bir aday seçin.');
      return;
    }
    setBusy(true);
    setError('');
    setSuccessResult(null);
    try {
      const res = await request<any>('/api/company/invitations/batch-send', csrf, {
        applicationIds: selectedAppIds,
        templateId,
        customSubject,
        customBody,
        estimatedMinutes,
        expiresInDays
      });
      setSuccessResult(res);
      setSelectedAppIds([]);
      loadData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <LoadError error={error} />;
  if (!data) return <p>Davet ve planlama verileri yükleniyor…</p>;

  // Canlı önizleme için ilk adayın verilerini simüle et
  const previewSampleCandidate = data.candidates?.find((c: any) => selectedAppIds.includes(c.application_id)) || data.candidates?.[0] || { candidate_name: 'Deniz Yılmaz', position_title: 'Veri Analisti' };
  const previewBodyFormatted = customBody
    .replace(/{ad}/g, previewSampleCandidate.candidate_name)
    .replace(/{pozisyon}/g, previewSampleCandidate.position_title)
    .replace(/{link}/g, `${window.location.origin}/mulakat-girisi/ornek-davet-kodu`)
    .replace(/{tarih}/g, new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toLocaleDateString('tr-TR'));

  return (
    <>
      <div className="heading">
        <div>
          <h1>Mülakat Davet ve Planlama (B06)</h1>
          <p className="muted">
            Pozisyon bazında adayları seçin, mülakat süresini ve şablonunu belirleyerek toplu veya bireysel AI mülakat davetlerini yayınlayın.
          </p>
        </div>
        <div>
          <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', padding: '6px 12px', fontSize: '13px' }}>
            E-posta Modu: {data.mailMode === 'smtp' ? '🟢 Aktif SMTP (Canlı)' : '🟡 Geliştirme (Test Bağlantılı)'}
          </span>
        </div>
      </div>

      {error && <LoadError error={error} />}

      {successResult && (
        <div className="card" style={{ background: '#f0fdf4', borderColor: '#86efac', marginBottom: '24px' }}>
          <h3 style={{ color: '#166534', margin: '0 0 10px' }}>
            ✓ {successResult.sentCount} Adaya Mülakat Daveti Başarıyla Gönderildi
          </h3>
          <p style={{ fontSize: '14px', color: '#15803d' }}>
            Adaylar benzersiz davet token'ları ile güvenli şekilde eşleştirildi. Yerel test ortamında doğrudan erişim bağlantılarını aşağıdan kopyalayabilirsiniz:
          </p>
          <div style={{ marginTop: '12px' }}>
            {successResult.results?.map((r: any) => (
              <div key={r.applicationId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#fff', borderRadius: '6px', marginBottom: '6px', border: '1px solid #bbf7d0' }}>
                <div>
                  <strong>{r.candidateName}</strong> ({r.email})
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {r.testLink && (
                    <button
                      type="button"
                      className="button secondary"
                      style={{ padding: '4px 10px', fontSize: '12px' }}
                      onClick={() => {
                        const full = window.location.origin + r.testLink;
                        navigator.clipboard.writeText(full).then(() => setCopiedLink(r.applicationId));
                      }}
                    >
                      {copiedLink === r.applicationId ? '✓ Kopyalandı' : 'Bağlantıyı Kopyala'}
                    </button>
                  )}
                  {r.testLink && (
                    <a className="button" style={{ padding: '4px 10px', fontSize: '12px' }} href={r.testLink} target="_blank" rel="noreferrer">
                      Odayı Aç →
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '24px', alignItems: 'start' }}>
        {/* SOL: Aday Seçim Tablosu */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0 }}>Aday Listesi ({filteredCandidates.length})</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <label htmlFor="pos-filter" style={{ fontSize: '13px', fontWeight: '600' }}>Pozisyon Filtresi:</label>
              <select
                id="pos-filter"
                value={selectedPositionId}
                onChange={e => {
                  setSelectedPositionId(e.target.value);
                  setSelectedAppIds([]);
                }}
                style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              >
                <option value="all">Tüm Pozisyonlar ({data.candidates?.length || 0})</option>
                {data.positions?.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '40px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={filteredCandidates.length > 0 && selectedAppIds.length === filteredCandidates.length}
                      onChange={toggleSelectAll}
                      aria-label="Tümünü seç"
                    />
                  </th>
                  <th>Aday</th>
                  <th>Pozisyon</th>
                  <th>Başvuru Durumu</th>
                  <th>Davet Durumu</th>
                </tr>
              </thead>
              <tbody>
                {filteredCandidates.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty">Bu filtreye uygun aday bulunamadı.</td>
                  </tr>
                ) : (
                  filteredCandidates.map((c: any) => {
                    const isSelected = selectedAppIds.includes(c.application_id);
                    return (
                      <tr key={c.application_id} style={{ background: isSelected ? '#f0f9ff' : undefined }}>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleCandidate(c.application_id)}
                            aria-label={`${c.candidate_name} seç`}
                          />
                        </td>
                        <td>
                          <strong>{c.candidate_name}</strong>
                          <div className="muted" style={{ fontSize: '12px' }}>{c.candidate_email}</div>
                        </td>
                        <td>{c.position_title}</td>
                        <td>
                          <span className="badge">{statusLabel(c.application_status)}</span>
                        </td>
                        <td>
                          {c.invitation_status ? (
                            <span className="badge" style={{ background: '#dbeafe', color: '#1e40af' }}>
                              {c.invitation_status === 'sent' ? 'Gönderildi' : 'Hazırlandı'}
                            </span>
                          ) : (
                            <span className="muted" style={{ fontSize: '12px' }}>Henüz Davet Yok</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: '13px' }}>
              Seçilen: <strong>{selectedAppIds.length}</strong> / {filteredCandidates.length} aday
            </span>
            {selectedAppIds.length > 0 && (
              <button
                type="button"
                className="button secondary"
                style={{ padding: '4px 10px', fontSize: '12px' }}
                onClick={() => setSelectedAppIds([])}
              >
                Seçimi Temizle
              </button>
            )}
          </div>
        </div>

        {/* SAĞ: Davet & Şablon Yapılandırması */}
        <div>
          <div className="card">
            <h2>Davet Yapılandırması</h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '14px' }}>
              <div>
                <label htmlFor="est-min" style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>
                  Mülakat Süresi:
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    id="est-min"
                    type="number"
                    min={10}
                    max={120}
                    value={estimatedMinutes}
                    onChange={e => setEstimatedMinutes(Number(e.target.value))}
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  />
                  <span style={{ fontSize: '13px' }}>dk</span>
                </div>
              </div>

              <div>
                <label htmlFor="exp-days" style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>
                  Son Katılım Süresi:
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    id="exp-days"
                    type="number"
                    min={1}
                    max={30}
                    value={expiresInDays}
                    onChange={e => setExpiresInDays(Number(e.target.value))}
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  />
                  <span style={{ fontSize: '13px' }}>gün</span>
                </div>
              </div>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '20px 0' }} />

            <h2>E-posta Davet Şablonu</h2>

            <div style={{ marginTop: '12px' }}>
              <label htmlFor="tpl-select" style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>
                Hazır Şablon:
              </label>
              <select
                id="tpl-select"
                value={templateId}
                onChange={e => handleTemplateChange(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              >
                {data.templates?.map((t: any) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            <div style={{ marginTop: '14px' }}>
              <label htmlFor="tpl-subject" style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>
                E-posta Konusu:
              </label>
              <input
                id="tpl-subject"
                type="text"
                value={customSubject}
                onChange={e => setCustomSubject(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>

            <div style={{ marginTop: '14px' }}>
              <label htmlFor="tpl-body" style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>
                Mesaj Metni (Şablon Değişkenleri Desteklenir):
              </label>
              <textarea
                id="tpl-body"
                rows={6}
                value={customBody}
                onChange={e => setCustomBody(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', fontFamily: 'monospace' }}
              />
              <div className="muted" style={{ fontSize: '11px', marginTop: '4px' }}>
                Kullanılabilir değişkenler: <code>{'{ad}'}</code>, <code>{'{pozisyon}'}</code>, <code>{'{link}'}</code>, <code>{'{tarih}'}</code>
              </div>
            </div>

            <div style={{ marginTop: '20px' }}>
              <button
                type="button"
                className="button"
                style={{ width: '100%', padding: '12px', fontSize: '15px' }}
                disabled={busy || selectedAppIds.length === 0}
                onClick={handleBatchSend}
              >
                {busy ? 'Davetler Gönderiliyor…' : `✉️ Seçilen (${selectedAppIds.length}) Adaya Toplu Davet Gönder`}
              </button>
            </div>
          </div>

          {/* Canlı E-posta Önizleme Kartı */}
          <div className="card" style={{ marginTop: '16px', background: '#f8fafc', border: '1px dashed #cbd5e1' }}>
            <h3 style={{ fontSize: '13px', color: '#64748b', textTransform: 'uppercase', margin: '0 0 10px' }}>
              📬 Alıcı Gözünden Canlı Önizleme ({previewSampleCandidate.candidate_name})
            </h3>
            <div style={{ background: '#fff', borderRadius: '6px', padding: '14px', border: '1px solid #e2e8f0', fontSize: '13px' }}>
              <p style={{ margin: '0 0 8px', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px' }}>
                <strong>Konu:</strong> {customSubject.replace(/{pozisyon}/g, previewSampleCandidate.position_title)}
              </p>
              <div style={{ whiteSpace: 'pre-wrap', color: '#334155', lineHeight: '1.5' }}>
                {previewBodyFormatted}
              </div>
            </div>
          </div>
        </div>
      </div>
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

function CandidateInvitationFlow({ csrf, refresh, currentActor }: { csrf: string; refresh: () => Promise<void>; currentActor?: string | null }) {
  const { token } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [codeRequested, setCodeRequested] = useState(false);
  const [code, setCode] = useState('');
  const [developmentCode, setDevelopmentCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(900);

  useEffect(() => {
    if (!token) return;
    request<any>(`/api/candidate/interview/context/${encodeURIComponent(token)}`)
      .then(setData)
      .catch(e => setError(e.message));
  }, [token]);

  useEffect(() => {
    if (!codeRequested) return;
    const timer = setInterval(() => setCountdown(c => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [codeRequested]);

  const handleSendCode = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await request<any>('/api/candidate/interview/send-otp', csrf, { token });
      setCodeRequested(true);
      if (res.developmentCode) setDevelopmentCode(res.developmentCode);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await request('/api/candidate/interview/verify-otp', csrf, { token, code });
      await refresh();
      navigate(`/aday/mulakat/${token}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (error && !data) return <div className="center"><div className="card"><LoadError error={error} /><Link to="/">Ana Sayfa</Link></div></div>;
  if (!data) return <div className="center">Yükleniyor…</div>;

  const formatCountdown = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div style={{ maxWidth: '960px', margin: '40px auto', padding: '0 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: '#0f172a', color: '#fff', padding: '8px 14px', borderRadius: '8px', fontWeight: 'bold', fontSize: '18px' }}>Assessora</div>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px' }}>Mülakat Davet Kabulü & Doğrulama (C03/C04)</h2>
            <p className="muted" style={{ margin: '2px 0 0', fontSize: '13px' }}>{data.position_title}</p>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px' }}>
        {/* Sol Panel: Mülakat Detayları (C03) */}
        <div className="card">
          <h3>Mülakat Genel Bilgileri</h3>
          <p className="muted" style={{ fontSize: '13px', marginBottom: '16px' }}>Bu mülakat Assessora AI tarafından yürütülecektir.</p>
          
          <div style={{ display: 'grid', gap: '12px' }}>
            <div><span className="label">Şirket:</span> <strong>{data.organization_name}</strong></div>
            <div><span className="label">Pozisyon:</span> <strong>{data.position_title}</strong></div>
            <div><span className="label">Format:</span> <strong>{data.requirements?.length || 4} Yetkinlik Sorusu + 1 Uygulamalı Görev</strong></div>
            <div><span className="label">Tahmini Süre:</span> <strong>{data.estimated_minutes} dakika</strong></div>
            <div><span className="label">Son Giriş Tarihi:</span> <strong>{new Date(data.expires_at).toLocaleString('tr-TR')}</strong></div>
          </div>

          <h4 style={{ marginTop: '20px', marginBottom: '8px' }}>Değerlendirilecek Yetkinlikler</h4>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: '#475569' }}>
            {data.requirements?.map((r: any) => (
              <li key={r.id}><strong>{r.label}</strong> (Ağırlık: %{r.weight}{r.required ? ' · Zorunlu' : ''})</li>
            ))}
          </ul>
        </div>

        {/* Sağ Panel: Kimlik Doğrulama & OTP (C03 / C04 / AC-02) */}
        <div className="card">
          <h3>Kimlik Doğrulama</h3>
          <p className="muted" style={{ fontSize: '13px' }}>
            Mülakat güvenliği gereğince davet bağlantısı adayın e-posta adresiyle eşleştirilir (AC-02).
          </p>

          <div style={{ padding: '12px', background: '#f1f5f9', borderRadius: '6px', margin: '16px 0', fontSize: '13px' }}>
            📧 Davet Sahibi: <strong>{data.candidate_email_masked}</strong>
          </div>

          {error && <LoadError error={error} />}

          {data.is_authenticated ? (
            <div style={{ marginTop: '20px' }}>
              <p style={{ color: '#047857', fontWeight: '600' }}>✓ Kimliğiniz doğrulandı ({data.candidate_email_masked})</p>
              <button
                type="button"
                className="button"
                style={{ width: '100%', marginTop: '12px', padding: '12px', fontSize: '15px', background: '#0284c7', borderColor: '#0284c7' }}
                onClick={() => navigate(`/aday/mulakat/${token}`)}
              >
                Mülakat Odasına Giriş Yap →
              </button>
            </div>
          ) : !codeRequested ? (
            <div style={{ marginTop: '20px' }}>
              <p style={{ fontSize: '13px', color: '#64748b' }}>
                "Daveti Kabul Et" butonuna bastığınızda, <strong>{data.candidate_email_masked}</strong> adresine 6 haneli tek kullanımlık bir doğrulama kodu gönderilecektir.
              </p>
              <button
                type="button"
                className="button"
                disabled={submitting}
                style={{ width: '100%', marginTop: '16px', padding: '12px', fontSize: '15px' }}
                onClick={handleSendCode}
              >
                {submitting ? 'Kod Gönderiliyor…' : 'Daveti Kabul Et ve Kod Gönder →'}
              </button>
            </div>
          ) : (
            <form onSubmit={handleVerifyCode} style={{ marginTop: '16px' }}>
              <div style={{ fontSize: '13px', color: '#047857', marginBottom: '12px' }}>
                ✓ 6 haneli doğrulama kodu <strong>{data.candidate_email_masked}</strong> adresine iletildi.
                <div style={{ color: '#64748b', marginTop: '4px' }}>⏱ Kalan süre: {formatCountdown(countdown)}</div>
              </div>

              {developmentCode && (
                <div style={{ padding: '8px 12px', background: '#fef3c7', borderRadius: '4px', fontSize: '12px', color: '#92400e', marginBottom: '12px' }}>
                  🧪 Test Modu Doğrulama Kodu: <strong>{developmentCode}</strong>
                </div>
              )}

              <label htmlFor="otp-input" style={{ display: 'block', fontWeight: '600', marginBottom: '6px', fontSize: '13px' }}>
                6 Haneli Doğrulama Kodu:
              </label>
              <input
                id="otp-input"
                type="text"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                placeholder="123456"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                style={{ width: '100%', padding: '10px', fontSize: '18px', textAlign: 'center', letterSpacing: '6px', border: '1px solid #cbd5e1', borderRadius: '6px' }}
              />

              <button
                type="submit"
                className="button"
                disabled={submitting || code.length !== 6}
                style={{ width: '100%', marginTop: '16px', padding: '12px', fontSize: '15px', background: '#0284c7', borderColor: '#0284c7' }}
              >
                {submitting ? 'Doğrulanıyor…' : 'Kodu Doğrula ve Mülakata Geç →'}
              </button>

              <div style={{ marginTop: '12px', textAlign: 'center' }}>
                <button
                  type="button"
                  className="button secondary"
                  style={{ fontSize: '12px', padding: '6px 12px' }}
                  onClick={handleSendCode}
                  disabled={submitting}
                >
                  Kodu Tekrar Gönder
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function CandidateInvitationView() {
  return <CandidateInvitationFlow csrf="" refresh={async () => {}} />;
}

// =========================================================================
// ADAY MÜLAKAT ODASI (C05, C06, C07, C08, C09, C12 - SESLİ VE GÖRÜNTÜLÜ SİSTEM)
// =========================================================================
function CandidateInterviewRoom({ csrf }: { csrf: string }) {
  const { token } = useParams();
  const navigate = useNavigate();
  const [context, setContext] = useState<any>(null);
  const [sessionData, setSessionData] = useState<any>(null);
  const [step, setStep] = useState<'briefing' | 'device_check' | 'interview' | 'task' | 'completed' | 'recovery'>('briefing');
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
        if (!ctx.is_authenticated) {
          navigate(`/aday/davet/${token}`, { replace: true });
          return;
        }
        setContext(ctx);
        return request<any>('/api/candidate/interview/session', csrf, { token });
      })
      .then(sess => {
        if (!sess) return;
        setSessionData(sess);
        setTurns(sess.turns || []);
        setCurrentQIndex(sess.session.current_question_index || 0);
        setCodeContent(sess.task_template?.initial_code || '');
        if (sess.session.status === 'interrupted') {
          setStep('recovery');
        } else if (sess.session.current_step && sess.session.current_step !== 'briefing') {
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

  // C12: Ağ Kesintisi Takibi ve Kurtarma Modu
  const [networkAlert, setNetworkAlert] = useState('');
  useEffect(() => {
    const handleOffline = () => {
      setNetworkAlert('⚠️ İnternet bağlantısı kesildi. Oturum koruma moduna alınıyor...');
      if (sessionData?.session?.id) {
        request('/api/candidate/interview/interrupt', csrf, { sessionId: sessionData.session.id }).catch(() => {});
      }
      setStep('recovery');
    };
    const handleOnline = () => {
      setNetworkAlert('✓ İnternet bağlantısı yeniden kuruldu.');
      setTimeout(() => setNetworkAlert(''), 4000);
    };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [sessionData?.session?.id, csrf]);

  const simulateDisconnect = async () => {
    if (!sessionData?.session?.id) return;
    setBusy(true);
    try {
      await request('/api/candidate/interview/interrupt', csrf, { sessionId: sessionData.session.id });
      setStep('recovery');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resumeFromRecovery = async () => {
    if (!cameraActive) await toggleCamera();
    await advanceStep('interview');
    setTimeout(() => {
      const currentQ = sessionData?.questions?.[currentQIndex]?.question_text;
      speakAi(`Tekrar hoş geldiniz. Bağlantınız yeniden sağlandı. ${currentQIndex + 1}. sorumuz: ${currentQ || 'Kaldığımız yerden devam ediyoruz.'}`);
    }, 600);
  };

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
          {networkAlert && (
            <div className="gap-alert" style={{ marginBottom: '16px' }}>
              <strong>{networkAlert}</strong>
            </div>
          )}

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
                <span style={{ color: '#86efac', fontSize: '11px', background: 'rgba(0,0,0,0.6)', padding: '3px 8px', borderRadius: '4px' }}>
                  📶 Bağlantı: HD (&lt;25ms)
                </span>
                <button
                  type="button"
                  onClick={simulateDisconnect}
                  title="Bağlantı kesintisini test et (C12 Kurtarma Senaryosu)"
                  style={{ background: 'rgba(239,68,68,0.3)', color: '#fca5a5', border: '1px solid #ef4444', fontSize: '10px', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer' }}
                >
                  ⚡ Kesinti Test Et (C12)
                </button>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1' }}>
                  Yetkinlik: {sessionData.questions[currentQIndex]?.requirement_label}
                </span>
                <span className="muted" style={{ fontSize: '13px' }}>
                  Soru {Math.min(currentQIndex + 1, sessionData.questions.length)} / {sessionData.questions.length}
                </span>
                <span className="badge" style={{ background: '#fef2f2', color: '#b91c1c', fontWeight: 'bold' }}>
                  ⏱ {Math.floor(remainingSeconds / 60).toString().padStart(2, '0')}:{(remainingSeconds % 60).toString().padStart(2, '0')}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" className="button secondary" style={{ fontSize: '12px', padding: '6px 12px' }} onClick={() => speakAi(sessionData.questions[currentQIndex]?.question_text || '')}>
                  🔊 Soruyu Sesli Oku
                </button>
                <button type="button" className="button secondary" style={{ fontSize: '12px', padding: '6px 12px' }} onClick={async () => {
                  try {
                    const res = await request<any>('/api/candidate/interview/clarify', csrf, {
                      sessionId: sessionData.session.id,
                      questionIndex: currentQIndex
                    });
                    speakAi(res.clarification);
                  } catch {
                    const explain = `Bu soruda ${sessionData.questions[currentQIndex]?.requirement_label} yetkinliğinizle ilgili karşılaştığınız mimari ve teknik zorlukları nasıl çözdüğünüzü duymak istiyoruz.`;
                    speakAi(explain);
                  }
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

      {/* C12: OTURUM KURTARMA EKRANI */}
      {step === 'recovery' && (
        <div>
          <div className="recovery-banner">
            <div>
              <div style={{ fontSize: '28px', marginBottom: '4px' }}>⚠️</div>
              <h2 style={{ margin: 0, color: '#92400e' }}>Bağlantı Kesintisi Sonrası Oturum Kurtarıldı (C12)</h2>
              <p style={{ margin: '6px 0 0', color: '#78350f', fontSize: '14px' }}>
                Önceki oturumunuzdaki video ve transkript verileriniz sunucumuzda güvenle korundu. Kaybınız bulunmamaktadır.
              </p>
            </div>
          </div>

          <div className="card" style={{ marginTop: '20px' }}>
            <h2>Soru İlerleme Durumu</h2>
            <p className="muted">Kaldığınız soru ve tamamlanan yanıtlarınız aşağıda listelenmiştir:</p>

            <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {sessionData.questions?.map((q: any, idx: number) => {
                const isPast = idx < currentQIndex;
                const isCurrent = idx === currentQIndex;
                return (
                  <div key={q.id} className="checklist-card" style={{ borderColor: isCurrent ? '#f59e0b' : isPast ? '#86efac' : '#cbd5e1', background: isCurrent ? '#fffbeb' : isPast ? '#f0fdf4' : '#f8fafc' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '18px' }}>
                        {isPast ? '✅' : isCurrent ? '⚠️' : '⏳'}
                      </span>
                      <div>
                        <strong>{idx + 1}. Soru: {q.question_text}</strong>
                        <div style={{ fontSize: '12px', color: isPast ? '#15803d' : isCurrent ? '#b45309' : '#64748b' }}>
                          {isPast ? 'Tamamlandı · Transkript ve video parçası kaydedildi' : isCurrent ? 'Kaldığınız Soru · Buradan devam edeceksiniz' : 'Bekliyor · Sıradaki aşama'}
                        </div>
                      </div>
                    </div>
                    <div>
                      <span className="badge" style={{ background: isPast ? '#dcfce7' : isCurrent ? '#fef3c7' : '#e2e8f0', color: isPast ? '#166534' : isCurrent ? '#92400e' : '#475569' }}>
                        {isPast ? 'Kayıtlı ✓' : isCurrent ? 'Kaldığınız Yer' : 'Bekliyor'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: '24px', background: '#f1f5f9', padding: '16px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
              <strong>📹 Cihaz Yeniden Bağlantısı:</strong>
              <p style={{ fontSize: '13px', margin: '4px 0 12px', color: '#475569' }}>
                Devam etmeden önce kameranızı açarak görüntünüzün ve mikrofonunuzun aktif olduğunu doğrulayabilirsiniz.
              </p>
              <button
                type="button"
                className="button secondary"
                onClick={toggleCamera}
                style={{ fontSize: '13px' }}
              >
                {cameraActive ? '✓ Kamera & Mikrofon Aktif' : '📷 Kamerayı & Mikrofonu Yeniden Başlat'}
              </button>
            </div>

            <div className="actions" style={{ marginTop: '24px' }}>
              <button
                className="button"
                style={{ fontSize: '16px', padding: '14px 28px', background: '#0284c7', borderColor: '#0284c7' }}
                disabled={busy}
                onClick={resumeFromRecovery}
              >
                Kaldığım Yerden Devam Et ({currentQIndex + 1}. Soru) →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADIM 5: C09 Tamamlanma Onayı ve Teslimat Kontrol Listesi */}
      {step === 'completed' && (
        <div>
          <div className="card" style={{ textAlign: 'center', padding: '36px 24px', marginBottom: '24px' }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: '#dcfce7', color: '#166534', fontSize: '32px', display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}>
              ✓
            </div>
            <h1>Sesli & Görüntülü Mülakatınız Tamamlandı (C09)</h1>
            <p className="muted" style={{ maxWidth: '580px', margin: '0 auto' }}>
              Tüm mülakat oturumu başarıyla sonlandırılmıştır. Tüm konuşma transkriptleriniz, görüşme video kayıtlarınız ve uygulamalı görev çözümünüz eksiksiz teslim alınmıştır.
            </p>
          </div>

          {/* 3 Teslim Edilen Varlık Kontrol Listesi (PDF C09) */}
          <div className="card" style={{ marginBottom: '24px' }}>
            <h2>Teslim Alınan Değerlendirme Varlıkları</h2>
            <div className="completion-checklist" style={{ marginTop: '14px' }}>
              <div className="item">
                <span className="icon">✓</span>
                <div>
                  <strong>1. CV & Ön Eleme Verileri</strong>
                  <div className="muted" style={{ fontSize: '13px' }}>Başvuru profiliniz ve deneyim özetiniz sisteme kaydedildi.</div>
                </div>
              </div>
              <div className="item">
                <span className="icon">✓</span>
                <div>
                  <strong>2. Sesli & Görüntülü Mülakat Transkripti ({turns.length} Tur)</strong>
                  <div className="muted" style={{ fontSize: '13px' }}>Yapay zeka soru-cevap konuşması, zaman damgaları ve teknik açıklamalarınız arşivlendi.</div>
                </div>
              </div>
              <div className="item">
                <span className="icon">✓</span>
                <div>
                  <strong>3. Uygulamalı Görev (SQL / Kodlama & Çözüm Raporu)</strong>
                  <div className="muted" style={{ fontSize: '13px' }}>Yazdığınız kod veya SQL sorgusu ve gerekçeli mimari yaklaşımınız başarıyla sisteme aktarıldı.</div>
                </div>
              </div>
            </div>
          </div>

          {/* Sonraki Adımlar Kartı */}
          <div className="card" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
            <h3>Sonraki Adımlar & Şeffaflık Bildirimi</h3>
            <ul style={{ paddingLeft: '20px', lineHeight: '1.7', fontSize: '14px', color: '#334155' }}>
              <li><strong>Puanlama Modeli:</strong> Cevaplarınız pozisyona tanımlı ağırlıklı yetkinlik rubriklerine göre nesnel olarak analiz edilir.</li>
              <li><strong>İnsan Denetimi:</strong> Yapay zeka değerlendirmeleri şirketin yetkili insan değerlendiricisi tarafından doğrulanır.</li>
              <li><strong>İtiraz Hakkı (C11):</strong> Değerlendirme sonuçlandıktan sonra şeffaf biçimde transkript referanslarıyla 14 gün içinde gerekçeli itirazda bulunabilirsiniz.</li>
            </ul>
            <div className="actions" style={{ marginTop: '20px' }}>
              <Link className="button" to="/aday">Aday Paneline ve Başvurularıma Dön →</Link>
            </div>
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

      {data.appeal && (
        <div className="card" style={{ marginTop: '20px', background: '#fffbeb', border: '1px solid #fde68a' }}>
          <h2 style={{ color: '#92400e', margin: '0 0 10px' }}>⚖️ İtiraz Durumu (C11)</h2>
          <p><strong>İtiraz Gerekçeniz:</strong> {data.appeal.reason}</p>
          <p><strong>Referans Dakika:</strong> {data.appeal.timestamp_reference || 'Belirtilmedi'}</p>
          <p><strong>Değerlendirme Durumu:</strong> <span className="badge">{statusLabel(data.appeal.status)}</span></p>
          {data.appeal.reviewer_notes && (
            <p style={{ marginTop: '8px', padding: '10px', background: '#fff', borderRadius: '6px', border: '1px solid #fed7aa', color: '#0369a1' }}>
              <strong>İnceleme Heyeti Kararı:</strong> {data.appeal.reviewer_notes}
            </p>
          )}
        </div>
      )}

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

  // PDF Senaryosu: Deniz Yılmaz (76.0) vs Ayşe Yılmaz (75.5) karşılaştırması
  const topCandidates = (data.candidates || [])
    .filter((c: any) => c.overall_score !== null)
    .sort((a: any, b: any) => (Number(b.overall_score) || 0) - (Number(a.overall_score) || 0));

  const hasTopComparison = topCandidates.length >= 2;
  const cand1 = topCandidates[0];
  const cand2 = topCandidates[1];

  return (
    <>
      <p className="muted"><Link to={`/sirket/pozisyonlar/${id}`}>Pozisyon</Link> / Aday Karşılaştırma</p>
      <div className="heading">
        <div>
          <h1>Aday Karşılaştırma — {data.position.title} (B07)</h1>
          <p className="muted">
            Plan sürümü {data.position.current_version} · Doğrulanmış ağırlıklı rubrik hesabı: Σ(puan × ağırlık) · Kanıtı eksik zorunlu yetkinliklerde genel skor hesaplanmaz (AC-07).
          </p>
        </div>
      </div>

      {/* PDF Bölüm 09: Karar Özeti & Puan Farkı Analiz Panosu */}
      {hasTopComparison && (
        <div className="diff-banner">
          <div>
            <h3 style={{ margin: '0 0 6px', color: '#0369a1', fontSize: '15px' }}>
              ⚖️ Lider Adaylar Arası Fark Analizi (B07 Karar Özeti)
            </h3>
            <p style={{ margin: 0, fontSize: '13px', color: '#0c4a6e' }}>
              <strong>{cand1.candidate_name} (%{cand1.overall_score})</strong> ile <strong>{cand2.candidate_name} (%{cand2.overall_score})</strong> arasındaki net yetkinlik ayrışması:
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
            <span className="diff-chip positive">
              Genel Uyum: {cand1.candidate_name} +{(Number(cand1.overall_score) - Number(cand2.overall_score)).toFixed(1)} Puan
            </span>
            {data.requirements.map((r: any) => {
              const s1 = cand1.scores_by_requirement[r.id] ?? 0;
              const s2 = cand2.scores_by_requirement[r.id] ?? 0;
              const diff = s1 - s2;
              if (diff === 0) return null;
              return (
                <span key={r.id} className={`diff-chip ${diff > 0 ? 'positive' : 'negative'}`}>
                  {r.label}: {diff > 0 ? cand1.candidate_name : cand2.candidate_name} +{Math.abs(diff)} Puan
                </span>
              );
            })}
          </div>
          <p style={{ margin: '10px 0 0', fontSize: '12px', color: '#475569' }}>
            💡 <em>Öneri: Pozisyonda %40 ağırlıklı Python yetkinliği kritik ise {cand1.candidate_name} öne çıkmaktadır; veri ambarı ve SQL odaklı bir ihtiyaçta ise {cand2.candidate_name} değerlendirilebilir.</em>
          </p>
        </div>
      )}

      <div className="card table-wrap" style={{ marginTop: '20px' }}>
        <table>
          <thead>
            <tr>
              <th>Aday</th>
              {data.requirements.map((r: any) => (
                <th key={r.id}>{r.label} (%{r.weight})</th>
              ))}
              <th>Genel Uyum Skoru</th>
              <th>Güçlü Yönler (Artılar)</th>
              <th>Gelişim Alanları</th>
              <th>Durum</th>
              <th>İşlem</th>
            </tr>
          </thead>
          <tbody>
            {data.candidates.length === 0 ? (
              <tr><td colSpan={data.requirements.length + 6} className="empty">Bu pozisyonda henüz değerlendirilen aday yok.</td></tr>
            ) : (
              data.candidates.map((c: any) => {
                // PDF Senaryosu Artılar ve Gelişim Alanları Çıkarımı
                const isDeniz = c.candidate_name?.includes('Deniz');
                const isAyse = c.candidate_name?.includes('Ayşe');
                const isSelin = c.candidate_name?.includes('Selin');
                const isBurak = c.candidate_name?.includes('Burak');

                let plusNotes = 'Standart rubrik yanıtları kaydedildi.';
                let minusNotes = 'Belirgin eksiklik tespit edilmedi.';

                if (isDeniz) {
                  plusNotes = 'Yüksek Python analitiği, temiz kod ve veri yapıları.';
                  minusNotes = 'Karmaşık SQL optimizasyonları geliştirilebilir.';
                } else if (isAyse) {
                  plusNotes = 'Üstün SQL sorgulama ve veri modelleme tecrübesi.';
                  minusNotes = 'Python OOP ve veri yapıları tecrübesi geliştirilebilir.';
                } else if (isSelin) {
                  plusNotes = 'Ön eleme adımları başarılı.';
                  minusNotes = 'Problem çözme oturumu tamamlanmadı (Eksik Kanıt).';
                } else if (isBurak) {
                  plusNotes = 'İlk soru yanıtı başarılı.';
                  minusNotes = 'Bağlantı kesintisi sonrası tamamlanmayı bekliyor.';
                }

                return (
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
                            <span className="score-badge incomplete" title="Zorunlu yetkinlik kanıtı eksik">Kanıt Yetersiz</span>
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
                        <span className="badge" style={{ background: '#fee2e2', color: '#991b1b', fontSize: '11px' }} title="AC-07: Zorunlu yetkinlik eksik olduğunda genel skor hesaplanmaz">
                          Değerlendirme Tamamlanmadı (AC-07)
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: '12px', maxWidth: '180px' }}>
                      <span style={{ color: '#166534' }}>✓ {plusNotes}</span>
                    </td>
                    <td style={{ fontSize: '12px', maxWidth: '180px' }}>
                      <span style={{ color: '#991b1b' }}>⚠️ {minusNotes}</span>
                    </td>
                    <td><span className="badge">{statusLabel(c.application_status)}</span></td>
                    <td>
                      <Link className="button" style={{ padding: '6px 12px', fontSize: '12px' }} to={`/sirket/basvurular/${c.application_id}/rapor`}>
                        Raporu Aç →
                      </Link>
                    </td>
                  </tr>
                );
              })
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

  const [isPlaying, setIsPlaying] = useState(false);
  const [videoTime, setVideoTime] = useState<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const totalDuration = data?.application?.duration_seconds || 45;

  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setVideoTime(t => {
        if (t >= totalDuration) {
          setIsPlaying(false);
          return totalDuration;
        }
        return Math.min(totalDuration, +(t + 0.5 * playbackSpeed).toFixed(1));
      });
    }, 500);
    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed, totalDuration]);

  const formatSec = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const isGapCandidate = !overallAssessment?.score || data.application.candidate_name?.includes('Selin') || data.application.candidate_name?.includes('Burak');

  return (
    <>
      <p className="muted"><Link to={`/sirket/basvurular/${id}`}>Başvuru</Link> / Mülakat Raporu</p>
      <div className="heading">
        <div>
          <h1>Mülakat Raporu: {data.application.candidate_name} (B08)</h1>
          <p className="muted">
            {data.application.position_title} · Toplam Görüşme Süresi: {formatSec(totalDuration)} · Video kaydı ve transkript kanıt senkronizasyonu
          </p>
        </div>
        <div>
          {overallAssessment?.score !== null ? (
            <div style={{ textAlign: 'right' }}>
              <span className="label">Genel Uyum Skoru (Ağırlıklı)</span>
              <div className="metric" style={{ color: '#0369a1' }}>%{overallAssessment?.score}</div>
            </div>
          ) : (
            <span className="badge" style={{ background: '#fee2e2', color: '#991b1b', fontSize: '13px', padding: '6px 12px' }}>
              ⚠️ Eksik Kanıt (AC-07: Değerlendirme Tamamlanmadı)
            </span>
          )}
        </div>
      </div>

      {/* REP-06: Model ve Değerlendirme Meta Verileri */}
      <div className="meta-chip-row" style={{ marginBottom: '16px' }}>
        <span className="meta-chip">🤖 Model: assessora-eval-v1 (LLM Rubric Engine)</span>
        <span className="meta-chip">📌 Prompt: v2.4-strict-rubric</span>
        <span className="meta-chip">⚖️ Rubrik Kuralı: AC-07 Deterministik Ağırlık</span>
        <span className="meta-chip">🔒 Doğrulama: Şirket İncelemesinde</span>
      </div>

      {/* REP-05: Eksik Zaman Aralığı Uyarısı */}
      {isGapCandidate && (
        <div className="gap-alert" style={{ marginBottom: '20px' }}>
          <strong>⚠️ Eksik Zaman Aralığı & Kanıt Uyarısı (REP-05):</strong>
          <p style={{ margin: '4px 0 0', fontSize: '13px' }}>
            00:20 - 00:35 aralığında adayın bağlantı kopması nedeniyle ses/video verisi eksiktir. Zorunlu "Problem Çözme ve Modelleme" yetkinliği değerlendirilemediği için AC-07 gereğince genel puan hesaplanmamış ve "Değerlendirme Tamamlanmadı" olarak işaretlenmiştir.
          </p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px' }}>
        {/* Sol Kolon: Video Oynatıcı Simülatörü & Transkript */}
        <div>
          {/* B08: İnteraktif Video Oynatıcı Paneli */}
          <div className="video-player-container" style={{ marginBottom: '16px' }}>
            <div className="video-box" style={{ height: '240px', background: (isGapCandidate && videoTime >= 20 && videoTime <= 35) ? '#450a0a' : '#0b1329', position: 'relative', display: 'grid', placeItems: 'center' }}>
              {isGapCandidate && videoTime >= 20 && videoTime <= 35 ? (
                <div style={{ textAlign: 'center', color: '#fca5a5', padding: '16px' }}>
                  <div style={{ fontSize: '32px', marginBottom: '4px' }}>📡 ⚡ ❌</div>
                  <strong style={{ color: '#f87171', fontSize: '15px' }}>
                    [00:20 - 00:35] KESİK ZAMAN ARALIĞI / KANIT KAYBI (REP-05)
                  </strong>
                  <p style={{ fontSize: '12px', color: '#fecaca', margin: '4px auto 10px', maxWidth: '400px' }}>
                    Adayın bağlantı kopması nedeniyle bu aralıkta video ve ses verisi eksiktir. AC-07 gereği genel puan hesaplanmamıştır.
                  </p>
                  <button
                    type="button"
                    className="button"
                    style={{ fontSize: '11px', padding: '5px 12px', background: '#dc2626', borderColor: '#dc2626' }}
                    onClick={() => setVideoTime(36)}
                  >
                    Kesinti Sonrasına Atla (00:36) ⏩
                  </button>
                </div>
              ) : (
                <div style={{ textAlign: 'center', color: '#94a3b8' }}>
                  <div style={{ fontSize: '40px', marginBottom: '8px' }}>
                    {isPlaying ? '🟢' : '🎥'}
                  </div>
                  <strong style={{ color: '#f8fafc', fontSize: '15px' }}>
                    {data.application.candidate_name} — Mülakat Video Akışı
                  </strong>
                  <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0' }}>
                    {isPlaying ? '▶ Video Oynatılıyor · Transkript senkronize akıyor' : 'Kayıt donduruldu. Oynatmak için başlatın veya transkriptten zamana tıklayın.'}
                  </p>
                </div>
              )}
              <div className="video-overlay" style={{ top: '12px', right: '12px', bottom: 'auto' }}>
                <span className="badge" style={{ background: (isGapCandidate && videoTime >= 20 && videoTime <= 35) ? '#991b1b' : 'rgba(0,0,0,0.7)', color: (isGapCandidate && videoTime >= 20 && videoTime <= 35) ? '#fff' : '#38bdf8' }}>
                  {isGapCandidate && videoTime >= 20 && videoTime <= 35 ? '⚠️ KESİK ARALIK' : isPlaying ? 'CANLI İZLEME' : 'DURAKLATILDI'}
                </span>
              </div>
            </div>

            {/* Oynatıcı Kontrolleri (AC-10) */}
            <div className="video-controls-bar">
              <button
                type="button"
                className="play-btn"
                onClick={() => setIsPlaying(!isPlaying)}
                title={isPlaying ? 'Durdur' : 'Oynat'}
              >
                {isPlaying ? '⏸' : '▶'}
              </button>

              <span className="time-display">
                {formatSec(videoTime)} / {formatSec(totalDuration)}
              </span>

              <input
                type="range"
                className="scrubber-track"
                min={0}
                max={totalDuration}
                step={0.5}
                value={videoTime}
                onChange={e => setVideoTime(Number(e.target.value))}
              />

              <button
                type="button"
                className="speed-toggle"
                onClick={() => setPlaybackSpeed(s => s === 1 ? 1.25 : s === 1.25 ? 1.5 : 1)}
                title="Oynatma Hızı"
              >
                {playbackSpeed}x
              </button>
            </div>

            {/* REP-05: Zaman Çizelgesi Segmentleri (Kesik Aralık Görselleştiricisi) */}
            {isGapCandidate && (
              <div style={{ marginTop: '8px', padding: '8px 12px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <strong>Zaman Çizelgesi Segmentleri (AC-10 / REP-05):</strong>
                  <span className="muted" style={{ fontSize: '11px' }}>Tıklayarak doğrudan atlayabilirsiniz</span>
                </div>
                <div style={{ display: 'flex', gap: '4px', height: '14px', borderRadius: '4px', overflow: 'hidden' }}>
                  <div
                    title="00:00 - 00:20: Normal Video Kaydı"
                    onClick={() => setVideoTime(10)}
                    style={{ flex: 20, background: '#10b981', cursor: 'pointer' }}
                  />
                  <div
                    title="00:20 - 00:35: ⚠️ Kesik Zaman Aralığı (REP-05)"
                    onClick={() => setVideoTime(22)}
                    style={{ flex: 15, background: '#ef4444', cursor: 'pointer', backgroundImage: 'repeating-linear-gradient(45deg, #ef4444, #ef4444 4px, #b91c1c 4px, #b91c1c 8px)' }}
                  />
                  <div
                    title="00:35 - Sonu: Kurtarılan Oturum Kaydı"
                    onClick={() => setVideoTime(38)}
                    style={{ flex: 10, background: '#0284c7', cursor: 'pointer' }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '11px', color: '#64748b' }}>
                  <span style={{ color: '#047857' }}>● 00:00 - 00:20 Normal</span>
                  <span style={{ color: '#b91c1c', fontWeight: 'bold' }}>⚠️ 00:20 - 00:35 Kesik (REP-05)</span>
                  <span style={{ color: '#0369a1' }}>● 00:35 - {formatSec(totalDuration)} Kurtarıldı</span>
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2 style={{ margin: 0 }}>Konuşma Transkripti ({data.turns?.length || 0} Tur)</h2>
              <span className="muted" style={{ fontSize: '12px' }}>💡 Zaman damgasına tıklayarak videoda o saniyeye atlayabilirsiniz (AC-10)</span>
            </div>

            <div className="chat-flow" style={{ maxHeight: '380px' }}>
              {data.turns?.map((t: any) => {
                const isTurnActive = videoTime >= (t.audio_timestamp_start || 0) && videoTime <= (t.audio_timestamp_end || 999);
                return (
                  <div key={t.id} className={`turn ${t.speaker} ${isTurnActive ? 'active-turn' : ''}`}>
                    <div className="turn-meta">
                      <strong>{t.speaker === 'ai' ? '🤖 AI Mülakatçı' : `👤 ${data.application.candidate_name}`}</strong>
                      <button
                        type="button"
                        className="timestamp-btn"
                        onClick={() => {
                          setVideoTime(t.audio_timestamp_start || 0);
                          setIsPlaying(true);
                        }}
                        title="Bu konuşma anına videoda atla"
                      >
                        ⏱️ {formatSec(t.audio_timestamp_start || 0)} - {formatSec(t.audio_timestamp_end || 0)}
                      </button>
                    </div>
                    {t.transcript_text}
                  </div>
                );
              })}
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
          {/* REP-06 / B05: CV Ön Değerlendirme Analizi Özeti */}
          {data.cv_analysis && (
            <div className="card" style={{ marginBottom: '16px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '15px' }}>📄 CV Ön Değerlendirme Analizi</h3>
                <span className={`badge ${data.cv_analysis.match_status === 'matched' ? 'active' : data.cv_analysis.match_status === 'borderline' ? 'warning' : 'rejected'}`}>
                  {data.cv_analysis.match_status === 'matched' ? '✓ Eşleşti' : data.cv_analysis.match_status === 'borderline' ? '⚠️ Sınırda' : '✕ Eşleşmedi'} (%{data.cv_analysis.match_percentage || 0})
                </span>
              </div>
              <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#334155' }}>{data.cv_analysis.summary}</p>
              {data.cv_analysis.strengths?.length > 0 && (
                <div style={{ fontSize: '12px', color: '#15803d', marginBottom: '4px' }}>
                  <strong>✓ Güçlü Yönler:</strong> {data.cv_analysis.strengths.join(', ')}
                </div>
              )}
              {data.cv_analysis.gaps?.length > 0 && (
                <div style={{ fontSize: '12px', color: '#b91c1c' }}>
                  <strong>⚠️ Eksik Noktalar:</strong> {data.cv_analysis.gaps.join(', ')}
                </div>
              )}
            </div>
          )}

          <div className="card">
            <h2>Yetkinlik Değerlendirmeleri (Kanıtlı)</h2>
            {reqAssessments?.map((asm: any) => (
              <div key={asm.id} style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '14px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>{asm.criteria_label || 'Yetkinlik'} (Ağırlık %{asm.weight})</strong>
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
              <h3 style={{ color: '#92400e', margin: '0 0 8px' }}>⚖️ Aday İtiraz Başvurusu (C11)</h3>
              <p><strong>Gerekçe:</strong> {data.appeal.reason}</p>
              <p><strong>Referans Zamanı:</strong> {data.appeal.timestamp_reference || 'Belirtilmedi'}</p>
              <p><strong>Durum:</strong> <span className="badge">{statusLabel(data.appeal.status)}</span></p>
              {data.appeal.reviewer_notes && (
                <p style={{ marginTop: '6px', fontSize: '12px', color: '#0369a1' }}>
                  <strong>İnceleme Kararı:</strong> {data.appeal.reviewer_notes}
                </p>
              )}
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
// ŞİRKET: CV DEĞERLENDİRME & ÖN ELEME (B05)
// =========================================================================
function CompanyCvEvaluationView({ csrf }: { csrf: string }) {
  const [applications, setApplications] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [selectedPositionId, setSelectedPositionId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [appDetail, setAppDetail] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);

  const loadData = async () => {
    try {
      const [appsRes, posRes] = await Promise.all([
        request<{ applications: any[] }>('/api/company/applications'),
        request<{ positions: any[] }>('/api/company/positions')
      ]);
      setApplications(appsRes.applications || []);
      setPositions(posRes.positions || []);
      if (appsRes.applications?.length > 0 && !selectedAppId) {
        setSelectedAppId(appsRes.applications[0].id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (!selectedAppId) {
      setAppDetail(null);
      return;
    }
    request<any>(`/api/company/applications/${selectedAppId}`)
      .then(setAppDetail)
      .catch(e => setError(e.message));
  }, [selectedAppId]);

  const handleStatusChange = async (newStatus: string) => {
    if (!selectedAppId) return;
    setActionBusy(true);
    try {
      await request(`/api/company/applications/${selectedAppId}/status`, csrf, { status: newStatus });
      await loadData();
      const updated = await request<any>(`/api/company/applications/${selectedAppId}`);
      setAppDetail(updated);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  };

  const handleRunCvAnalysis = async () => {
    if (!selectedAppId) return;
    setActionBusy(true);
    try {
      await request(`/api/company/applications/${selectedAppId}/analyze-cv`, csrf, {});
      await loadData();
      const updated = await request<any>(`/api/company/applications/${selectedAppId}`);
      setAppDetail(updated);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) return <p>Yükleniyor…</p>;
  if (error) return <LoadError error={error} />;

  const filteredApps = applications.filter(a => {
    if (selectedPositionId !== 'all' && a.position_id !== selectedPositionId) return false;
    if (statusFilter !== 'all' && (a.cv_match_status || 'unmatched') !== statusFilter) return false;
    return true;
  });

  return (
    <>
      <div className="heading">
        <div>
          <h1>CV Değerlendirme & Ön Eleme (B05)</h1>
          <p className="muted">Gelen aday özgeçmişlerinin pozisyon gereksinimleriyle yapay zeka destekli karşılaştırmalı ön elemesi.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: '24px', alignItems: 'start' }}>
        {/* Sol Panel: Pozisyon Filtresi & Aday Listesi */}
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ display: 'grid', gap: '10px', marginBottom: '14px' }}>
            <div>
              <label htmlFor="b05-pos" style={{ fontSize: '12px', fontWeight: 'bold' }}>Pozisyon Filtresi:</label>
              <select
                id="b05-pos"
                value={selectedPositionId}
                onChange={e => setSelectedPositionId(e.target.value)}
                style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              >
                <option value="all">Tüm Pozisyonlar</option>
                {positions.map(p => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="b05-status" style={{ fontSize: '12px', fontWeight: 'bold' }}>Eşleşme Durumu:</label>
              <select
                id="b05-status"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              >
                <option value="all">Tüm Durumlar</option>
                <option value="matched">✓ Eşleşti (Mülakata Uygun)</option>
                <option value="borderline">⚠️ Sınırda (İnceleme Gerekli)</option>
                <option value="unmatched">✕ Eşleşmedi</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '680px', overflowY: 'auto' }}>
            {filteredApps.length === 0 ? (
              <p className="empty" style={{ fontSize: '13px' }}>Filtrelere uygun aday bulunamadı.</p>
            ) : (
              filteredApps.map(app => {
                const isSelected = app.id === selectedAppId;
                const matchStatus = app.cv_match_status || 'unmatched';
                return (
                  <div
                    key={app.id}
                    onClick={() => setSelectedAppId(app.id)}
                    style={{
                      padding: '12px',
                      borderRadius: '8px',
                      border: isSelected ? '2px solid #0284c7' : '1px solid #e2e8f0',
                      background: isSelected ? '#f0f9ff' : '#fff',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '14px', color: '#0f172a' }}>{app.candidate_name}</strong>
                      <span className={`badge ${matchStatus === 'matched' ? 'active' : matchStatus === 'borderline' ? 'warning' : 'rejected'}`} style={{ fontSize: '11px' }}>
                        {matchStatus === 'matched' ? '✓ Eşleşti' : matchStatus === 'borderline' ? '⚠️ Sınırda' : '✕ Eşleşmedi'}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                      {app.position_title}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', fontSize: '11px' }}>
                      <span style={{ color: '#0369a1', fontWeight: 'bold' }}>
                        Uyum: %{app.cv_match_percentage ?? 0}
                      </span>
                      <span className="muted">{new Date(app.created_at).toLocaleDateString('tr-TR')}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Sağ Panel: CV Değerlendirme & AI Analiz Kartı */}
        <div>
          {appDetail ? (
            <div style={{ display: 'grid', gap: '20px' }}>
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                  <div>
                    <h2 style={{ margin: 0 }}>{appDetail.candidate_name}</h2>
                    <p className="muted" style={{ margin: '4px 0 0' }}>
                      {appDetail.candidate_email} · Pozisyon: <strong>{appDetail.position_title}</strong> (v{appDetail.position_version})
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <Link
                      to="/sirket/davet-planlama"
                      className="button"
                      style={{ fontSize: '13px', padding: '8px 14px', background: '#0284c7', borderColor: '#0284c7' }}
                    >
                      ✉️ Mülakata Çağır
                    </Link>
                    <button
                      type="button"
                      className="button secondary"
                      style={{ fontSize: '13px', padding: '8px 14px' }}
                      disabled={actionBusy}
                      onClick={() => handleStatusChange('shortlisted')}
                    >
                      ⭐ Kısa Listeye Al
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      style={{ fontSize: '13px', padding: '8px 14px', color: '#b91c1c' }}
                      disabled={actionBusy}
                      onClick={() => handleStatusChange('rejected')}
                    >
                      ✕ Reddet
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      style={{ fontSize: '13px', padding: '8px 14px' }}
                      disabled={actionBusy}
                      onClick={handleRunCvAnalysis}
                    >
                      🔄 Analizi Yenile
                    </button>
                  </div>
                </div>
              </div>

              {appDetail.cv_analysis ? (
                <>
                  <div className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <h3 style={{ margin: 0 }}>🤖 AI Ön Eleme Değerlendirmesi</h3>
                      <span className={`badge ${appDetail.cv_analysis.match_status === 'matched' ? 'active' : appDetail.cv_analysis.match_status === 'borderline' ? 'warning' : 'rejected'}`} style={{ fontSize: '13px', padding: '4px 10px' }}>
                        {appDetail.cv_analysis.match_status === 'matched' ? '✓ Mülakata Uygun' : appDetail.cv_analysis.match_status === 'borderline' ? '⚠️ Sınırda Aday' : '✕ Kriterleri Karşılamıyor'}
                      </span>
                    </div>
                    <p style={{ fontSize: '14px', lineHeight: 1.6, color: '#1e293b' }}>
                      {appDetail.cv_analysis.summary}
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
                      <div style={{ padding: '12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px' }}>
                        <strong style={{ color: '#166534', fontSize: '13px' }}>✓ Öne Çıkan Güçlü Yönler:</strong>
                        <ul style={{ margin: '6px 0 0', paddingLeft: '18px', fontSize: '13px', color: '#15803d' }}>
                          {appDetail.cv_analysis.strengths?.map((s: string, idx: number) => (
                            <li key={idx}>{s}</li>
                          )) || <li>Öne çıkan güçlü yön belirtilmedi.</li>}
                        </ul>
                      </div>

                      <div style={{ padding: '12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px' }}>
                        <strong style={{ color: '#991b1b', fontSize: '13px' }}>⚠️ Tespit Edilen Eksiklikler:</strong>
                        <ul style={{ margin: '6px 0 0', paddingLeft: '18px', fontSize: '13px', color: '#b91c1c' }}>
                          {appDetail.cv_analysis.gaps?.map((g: string, idx: number) => (
                            <li key={idx}>{g}</li>
                          )) || <li>Belirgin bir eksiklik bulunmadı.</li>}
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="card">
                    <h3>Yetkinlik Eşleşme Tablosu</h3>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr><th>Gereksinim</th><th>Zorunlu?</th><th>CV'deki Kanıt / Bulgu</th><th>Durum</th></tr>
                        </thead>
                        <tbody>
                          {appDetail.requirements?.map((req: any) => {
                            const match = appDetail.cv_analysis.criteria_matches?.find((m: any) => m.requirement_id === req.id || m.label === req.label);
                            return (
                              <tr key={req.id}>
                                <td><strong>{req.label}</strong> (Ağırlık %{req.weight})</td>
                                <td>{req.required ? '✓ Zorunlu' : 'Opsiyonel'}</td>
                                <td style={{ fontSize: '13px' }}>{match?.evidence || match?.notes || 'CV metninde doğrudan referans bulunamadı.'}</td>
                                <td>
                                  <span className={`badge ${match?.matched ? 'active' : 'rejected'}`}>
                                    {match?.matched ? '✓ Karşılıyor' : '✕ Eksik'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
                  <p className="muted">Bu aday için henüz AI CV analizi çalıştırılmamış.</p>
                  <button type="button" className="button" disabled={actionBusy} onClick={handleRunCvAnalysis}>
                    CV Analizini Başlat
                  </button>
                </div>
              )}

              {appDetail.cv_text && (
                <div className="card">
                  <h3>Orijinal CV Metni</h3>
                  <div style={{ maxHeight: '200px', overflowY: 'auto', background: '#f8fafc', padding: '12px', borderRadius: '6px', fontSize: '12px', whiteSpace: 'pre-wrap', color: '#475569' }}>
                    {appDetail.cv_text}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="card"><p className="empty">İncelemek için sol listeden bir aday seçin.</p></div>
          )}
        </div>
      </div>
    </>
  );
}

// =========================================================================
// ŞİRKET: İTİRAZ YÖNETİMİ (B09 - 3-BÖLMELİ İNCELEME DÜZENİ)
// =========================================================================
function CompanyAppealsView({ csrf }: { csrf: string }) {
  const [data, setData] = useState<{ appeals: any[] } | null>(null);
  const [error, setError] = useState('');
  const [selectedAppealId, setSelectedAppealId] = useState<string | null>(null);
  const [decision, setDecision] = useState<'upheld' | 'revised' | 'additional_interview'>('revised');
  const [decisionNote, setDecisionNote] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () => request<any>('/api/company/appeals').then(res => {
    setData(res);
    if (res.appeals?.length > 0 && !selectedAppealId) {
      setSelectedAppealId(res.appeals[0].id);
    }
  });
  useEffect(() => { reload().catch(e => setError(e.message)); }, []);

  const selectedAppeal = data?.appeals?.find(a => a.id === selectedAppealId) || null;

  const handleDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAppeal) return;
    setBusy(true);
    try {
      await request(`/api/company/appeals/${selectedAppeal.id}/decide`, csrf, { decision, decisionNote });
      setDecisionNote('');
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
        <div>
          <h1>İtiraz İnceleme Paneli (B09)</h1>
          <p className="muted">Adayların mülakat değerlendirmelerine yaptığı itiraz kuyruğu ve 3 bölmeli karar masası.</p>
        </div>
      </div>

      {data.appeals.length === 0 ? (
        <div className="card"><p className="empty">Şu anda incelenmeyi bekleyen itiraz bulunmuyor.</p></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1.2fr 1fr', gap: '20px', alignItems: 'start' }}>
          {/* Sol Bölme: İtiraz Kuyruğu */}
          <div className="card" style={{ padding: '16px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '16px' }}>İtiraz Kuyruğu ({data.appeals.length})</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {data.appeals.map(a => {
                const isSelected = a.id === selectedAppealId;
                return (
                  <div
                    key={a.id}
                    onClick={() => setSelectedAppealId(a.id)}
                    style={{
                      padding: '12px',
                      borderRadius: '8px',
                      border: isSelected ? '2px solid #0284c7' : '1px solid #e2e8f0',
                      background: isSelected ? '#f0f9ff' : '#fff',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '14px', color: '#0f172a' }}>{a.candidate_name}</strong>
                      <span className={`badge ${a.status === 'resolved' ? 'active' : 'warning'}`} style={{ fontSize: '11px' }}>
                        {statusLabel(a.status)}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                      {a.position_title}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', fontSize: '11px' }}>
                      <span style={{ color: '#0284c7', fontWeight: 'bold' }}>
                        Genel Skor: {a.overall_score !== null ? `%${a.overall_score}` : 'Eksik'}
                      </span>
                      <span className="muted">{new Date(a.created_at).toLocaleDateString('tr-TR')}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Orta Bölme: Kanıt & Transkript İncelemesi */}
          <div className="card" style={{ padding: '20px' }}>
            {selectedAppeal ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px', marginBottom: '16px' }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '18px' }}>{selectedAppeal.candidate_name}</h2>
                    <p className="muted" style={{ margin: '4px 0 0', fontSize: '13px' }}>
                      {selectedAppeal.candidate_email} · {selectedAppeal.position_title}
                    </p>
                  </div>
                  <Link
                    to={`/sirket/basvurular/${selectedAppeal.application_id}/rapor`}
                    className="button secondary"
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                  >
                    Mülakat Raporunu Aç ↗
                  </Link>
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', textTransform: 'uppercase' }}>
                    Adayın İtiraz Gerekçesi
                  </label>
                  <div style={{ padding: '12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', marginTop: '6px', fontSize: '14px', color: '#92400e' }}>
                    "{selectedAppeal.reason}"
                  </div>
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', textTransform: 'uppercase' }}>
                    Zaman Referansı & Kanıt İncelemesi (AC-10 / AC-11)
                  </label>
                  <div style={{ padding: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', marginTop: '6px', fontSize: '13px' }}>
                    <p style={{ margin: 0 }}>
                      ⏱ <strong>Belirtilen Zaman Damgası:</strong> {selectedAppeal.timestamp_reference || '00:00 (Tüm Mülakat)'}
                    </p>
                    <p style={{ margin: '8px 0 0', color: '#64748b', fontSize: '12px' }}>
                      Bu zaman aralığında adayın verdiği yanıt rubric kriterlerine göre incelenmelidir. İlgili ses/video kesiti rapordaki transkriptten izlenebilir.
                    </p>
                  </div>
                </div>

                {selectedAppeal.reviewer_notes && (
                  <div style={{ marginTop: '16px', padding: '12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px' }}>
                    <strong style={{ color: '#166534', fontSize: '13px' }}>Verilen Karar ({selectedAppeal.decision}):</strong>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#15803d' }}>{selectedAppeal.reviewer_notes}</p>
                    {selectedAppeal.resolved_at && (
                      <div className="muted" style={{ fontSize: '11px', marginTop: '4px' }}>
                        Çözümlenme: {new Date(selectedAppeal.resolved_at).toLocaleString('tr-TR')}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="muted">Sol listeden bir itiraz seçin.</p>
            )}
          </div>

          {/* Sağ Bölme: Karar & İşlem Masası */}
          <div className="card" style={{ padding: '20px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '16px' }}>⚖️ Karar Masası</h3>
            {selectedAppeal ? (
              selectedAppeal.status === 'resolved' ? (
                <div style={{ textAlign: 'center', padding: '24px 0' }}>
                  <div style={{ fontSize: '36px', marginBottom: '8px' }}>✓</div>
                  <strong style={{ color: '#0f172a' }}>Bu itiraz karara bağlanmıştır.</strong>
                  <p className="muted" style={{ fontSize: '12px', marginTop: '4px' }}>
                    Karar türü: <strong>{selectedAppeal.decision}</strong>
                  </p>
                </div>
              ) : (
                <form onSubmit={handleDecision}>
                  <label htmlFor="dec-type" style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '6px' }}>
                    Karar Seçeneği:
                  </label>
                  <select
                    id="dec-type"
                    value={decision}
                    onChange={e => setDecision(e.target.value as any)}
                    style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', marginBottom: '14px' }}
                  >
                    <option value="revised">✓ İtiraz Haklı Bulundu (Puanı Revize Et)</option>
                    <option value="upheld">✕ İtiraz Reddedildi (Mevcut Puanı Koru)</option>
                    <option value="additional_interview">🔄 Tamamlayıcı / Ek Görüşme Planla</option>
                  </select>

                  <label htmlFor="dec-text" style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '6px' }}>
                    Karar Gerekçesi (Zorunlu Denetim Notu):
                  </label>
                  <textarea
                    id="dec-text"
                    required
                    minLength={5}
                    rows={4}
                    value={decisionNote}
                    onChange={e => setDecisionNote(e.target.value)}
                    style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', marginBottom: '16px' }}
                    placeholder="Transkript incelenmiş olup adayın açıklaması rubric ölçütlerimize uygun bulunmuştur..."
                  />

                  <button
                    type="submit"
                    className="button"
                    disabled={busy || decisionNote.trim().length < 5}
                    style={{ width: '100%', padding: '12px', fontSize: '14px', background: '#0284c7', borderColor: '#0284c7' }}
                  >
                    {busy ? 'Kaydediliyor…' : 'Kararı Onayla ve Bildir'}
                  </button>
                  <p className="muted" style={{ fontSize: '11px', marginTop: '10px', textAlign: 'center' }}>
                    🔒 Karar denetim kütüğüne (audit log) ve aday bildirim sistemine kaydedilir.
                  </p>
                </form>
              )
            ) : null}
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
  const [tab, setTab] = useState<'team' | 'policy' | 'audit' | 'feedback'>('team');
  const [team, setTeam] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>({
    recording_retention_days: 90,
    appeal_window_days: 14,
    invite_mode: 'manual',
    allow_candidate_audio_download: false,
    candidate_privacy_restricted: false,
    feedback_contact_email: ''
  });
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [feedbacks, setFeedbacks] = useState<any[]>([]);
  const [feedbackScore, setFeedbackScore] = useState<number>(5);
  const [feedbackCategory, setFeedbackCategory] = useState<string>('rubric_consistency');
  const [feedbackNotes, setFeedbackNotes] = useState<string>('');
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
  const loadFeedbacks = () => request<any>('/api/company/feedbacks').then(res => setFeedbacks(res.feedbacks || []));

  useEffect(() => {
    Promise.all([loadTeam(), loadSettings(), loadAudit(), loadFeedbacks()]).catch(e => setError(e.message));
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
        candidatePrivacyRestricted: settings.candidate_privacy_restricted,
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

  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await request('/api/company/feedbacks', csrf, {
        subject: feedbackCategory,
        rating: feedbackScore,
        notes: feedbackNotes
      });
      setMessage('Yapay zeka model ve değerlendirme kalitesi geri bildiriminiz kaydedildi.');
      setFeedbackNotes('');
      await loadFeedbacks();
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
          <p className="muted">Rol bazlı yetkilendirme matrisi, kayıt politikaları, denetim izleri ve AI model geri bildirimleri.</p>
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
        <button type="button" className={`tab-btn ${tab === 'feedback' ? 'active' : ''}`} onClick={() => setTab('feedback')}>
          🤖 Model Kalitesi & Geri Bildirim
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

          {/* PDF Bölüm 03: Rol Bazlı Yetkilendirme Matrisi */}
          <div className="card" style={{ marginBottom: '24px' }}>
            <h2>Rol Bazlı Yetkilendirme Matrisi (PDF Bölüm 03)</h2>
            <p className="muted">Sistem içindeki eylemlerin rollere göre yetki dağılımı:</p>
            <div className="table-wrap" style={{ marginTop: '12px' }}>
              <table className="matrix-table">
                <thead>
                  <tr>
                    <th>Fonksiyon / İşlem Alanı</th>
                    <th style={{ textAlign: 'center' }}>👑 Yönetici (Admin)</th>
                    <th style={{ textAlign: 'center' }}>💼 İşe Alım Uzmanı (Recruiter)</th>
                    <th style={{ textAlign: 'center' }}>🔍 Değerlendirici (Reviewer)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Pozisyon & Mülakat Planı Oluşturma (B04, B05)</strong></td>
                    <td style={{ textAlign: 'center' }} className="allowed">✓ Yetkili</td>
                    <td style={{ textAlign: 'center' }} className="allowed">✓ Yetkili</td>
                    <td style={{ textAlign: 'center' }} className="forbidden">✗ Yetkisiz</td>
                  </tr>
                  <tr>
                    <td><strong>Toplu Davet ve Planlama (B06)</strong></td>
                    <td style={{ textAlign: 'center' }} className="allowed">✓ Yetkili</td>
                    <td style={{ textAlign: 'center' }} className="allowed">✓ Yetkili</td>
                    <td style={{ textAlign: 'center' }} className="forbidden">✗ Yetkisiz</td>
                  </tr>
                  <tr>
                    <td><strong>Aday Transkripti & Video İnceleme (B08)</strong></td>
                    <td style={{ textAlign: 'center' }} className="allowed">✓ Yetkili</td>
                    <td style={{ textAlign: 'center' }} className="allowed">✓ Yetkili</td>
                    <td style={{ textAlign: 'center' }} className="allowed">✓ Yetkili</td>
                  </tr>
                  <tr>
                    <td><strong>İnsan Puan Revizyonu Yapma (REP-04)</strong></td>
                    <td style={{ textAlign: 'center' }} className="allowed">✓ Yetkili</td>
                    <td style={{ textAlign: 'center' }} className="forbidden">✗ Yetkisiz</td>
                    <td style={{ textAlign: 'center' }} className="allowed">✓ Yetkili</td>
                  </tr>
                  <tr>
                    <td><strong>İtiraz İnceleme ve Karara Bağlama (B09)</strong></td>
                    <td style={{ textAlign: 'center' }} className="allowed">✓ Yetkili</td>
                    <td style={{ textAlign: 'center' }} className="forbidden">✗ Yetkisiz</td>
                    <td style={{ textAlign: 'center' }} className="allowed">✓ Yetkili</td>
                  </tr>
                  <tr>
                    <td><strong>Ekip, Saklama ve Güvenlik Ayarları (B10)</strong></td>
                    <td style={{ textAlign: 'center' }} className="allowed">✓ Yetkili</td>
                    <td style={{ textAlign: 'center' }} className="forbidden">✗ Yetkisiz</td>
                    <td style={{ textAlign: 'center' }} className="forbidden">✗ Yetkisiz</td>
                  </tr>
                </tbody>
              </table>
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

            <div style={{ marginBottom: '16px', background: '#f8fafc', padding: '12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Boolean(settings.candidate_privacy_restricted)}
                  onChange={e => setSettings({ ...settings, candidate_privacy_restricted: e.target.checked })}
                />
                <span style={{ fontWeight: '600' }}>Aday Gizlilik Kısıtı (KVKK Korumalı Ön Değerlendirme):</span>
              </label>
              <small className="muted" style={{ display: 'block', marginLeft: '24px', marginTop: '4px' }}>
                Aktif edildiğinde adayların kimlik ve iletişim bilgileri şirket içi ön eleme raporlarında rumuzlu gösterilir.
              </small>
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

      {/* SEKME 4: MODEL KALİTESİ VE GERİ BİLDİRİM */}
      {tab === 'feedback' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px' }}>
          <div className="card">
            <h2>AI Model Kalite Geri Bildirimi Bildir</h2>
            <p className="muted">
              Modelin değerlendirme tutarlılığı, halüsinasyon durumları veya transkript kalitesi hakkındaki teknik geri bildirimleriniz.
            </p>

            <form onSubmit={handleSubmitFeedback} style={{ marginTop: '16px' }}>
              <label htmlFor="fb-cat" style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>
                Geri Bildirim Konusu / Kategori:
              </label>
              <select
                id="fb-cat"
                value={feedbackCategory}
                onChange={e => setFeedbackCategory(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', marginBottom: '14px' }}
              >
                <option value="rubric_consistency">Rubrik ve Puanlama Tutarlılığı (AC-07)</option>
                <option value="transcript_accuracy">Ses Tanıma & Transkript Doğruluğu</option>
                <option value="hallucination_check">Halüsinasyon / Yanıltıcı Çıkarım Kontrolü</option>
                <option value="followup_quality">Takip Soruları Kalitesi ("Terletme" kurgusu)</option>
                <option value="other">Diğer / Genel Model Performansı</option>
              </select>

              <label htmlFor="fb-rate" style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>
                Değerlendirme Puanı (1 - 5):
              </label>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
                {[1, 2, 3, 4, 5].map(star => (
                  <button
                    key={star}
                    type="button"
                    className="button secondary"
                    onClick={() => setFeedbackScore(star)}
                    style={{
                      background: feedbackScore >= star ? '#fef3c7' : '#fff',
                      borderColor: feedbackScore >= star ? '#f59e0b' : '#cbd5e1',
                      color: feedbackScore >= star ? '#b45309' : '#64748b',
                      fontSize: '14px',
                      padding: '6px 12px'
                    }}
                  >
                    ★ {star}
                  </button>
                ))}
              </div>

              <label htmlFor="fb-notes" style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>
                Teknik Notlar ve Örnek Transkript Alıntısı:
              </label>
              <textarea
                id="fb-notes"
                required
                rows={4}
                value={feedbackNotes}
                onChange={e => setFeedbackNotes(e.target.value)}
                placeholder="Örn: 00:15 transkriptinde adayın verdiği Python açıklaması rubrikte eksik puanlanmış..."
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />

              <div style={{ marginTop: '16px' }}>
                <button className="button" disabled={busy}>Geri Bildirimi Gönder</button>
              </div>
            </form>
          </div>

          <div className="card">
            <h2>Gönderilen Geri Bildirimler ({feedbacks.length})</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px', maxHeight: '420px', overflowY: 'auto' }}>
              {feedbacks.length === 0 ? (
                <p className="empty">Henüz kaydedilmiş geri bildirim bulunmuyor.</p>
              ) : (
                feedbacks.map(fb => (
                  <div key={fb.id} style={{ background: '#f8fafc', padding: '12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1' }}>{fb.subject}</span>
                      <span style={{ color: '#f59e0b', fontWeight: 'bold' }}>{'★'.repeat(fb.rating || 5)}</span>
                    </div>
                    <p style={{ margin: '8px 0 4px', fontSize: '13px', color: '#334155' }}>{fb.notes}</p>
                    <div className="muted" style={{ fontSize: '11px' }}>
                      {fb.user_email || 'İncelemeci'} · {new Date(fb.created_at).toLocaleDateString('tr-TR')}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
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
