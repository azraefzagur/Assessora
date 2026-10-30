import 'dotenv/config';
import { pool, transaction } from './db.ts';
import { newId, hashPassword } from './security.ts';
import { invitationHash } from './invitation.ts';

export async function seedPdfDemo() {
  console.log('PDF Şartnamesine (v1.0) uygun gerçekçi test verileri yükleniyor...');
  await transaction(async client => {
    // 1. Şirket: Atlas Teknoloji A.Ş.
    let org = (await client.query('SELECT id FROM organizations LIMIT 1')).rows[0];
    let orgId: string;
    if (org) {
      orgId = org.id;
      await client.query("UPDATE organizations SET name='Atlas Teknoloji A.Ş.' WHERE id=$1", [orgId]);
    } else {
      orgId = newId();
      await client.query("INSERT INTO organizations (id, name) VALUES ($1, 'Atlas Teknoloji A.Ş.')", [orgId]);
    }

    // 2. Şirket Ayarları
    await client.query(`
      INSERT INTO organization_settings (organization_id, recording_retention_days, appeal_window_days, invite_mode, allow_candidate_audio_download, candidate_privacy_restricted, feedback_contact_email)
      VALUES ($1, 90, 14, 'manual', false, true, 'ik@atlasteknoloji.com')
      ON CONFLICT (organization_id) DO UPDATE
      SET recording_retention_days = 90, appeal_window_days = 14, invite_mode = 'manual', candidate_privacy_restricted = true, feedback_contact_email = 'ik@atlasteknoloji.com'
    `, [orgId]);

    // 3. Kullanıcılar & Roller (Yönetici, İşe Alım, Değerlendirici)
    const users = [
      { email: 'admin@assessora.local', role: 'admin', pass: 'Assessora123!' },
      { email: 'admin@atlasteknoloji.com', role: 'admin', pass: 'Assessora123!' },
      { email: 'ik@atlasteknoloji.com', role: 'recruiter', pass: 'Assessora123!' },
      { email: 'degerlendirici@atlasteknoloji.com', role: 'reviewer', pass: 'Assessora123!' }
    ];

    const userMap: Record<string, string> = {};
    for (const u of users) {
      let userRow = (await client.query('SELECT id FROM users WHERE lower(email) = $1', [u.email])).rows[0];
      if (!userRow) {
        const uId = newId();
        await client.query('INSERT INTO users (id, email, password_hash, development_only) VALUES ($1, $2, $3, false)', [uId, u.email, hashPassword(u.pass)]);
        userRow = { id: uId };
      }
      userMap[u.role] = userRow.id;

      await client.query(`
        INSERT INTO memberships (id, organization_id, user_id, role, active)
        VALUES ($1, $2, $3, $4, true)
        ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role, active = true
      `, [newId(), orgId, userRow.id, u.role]);
    }

    // 4. Pozisyon: Veri Analisti (PDF Bölüm 09 & UI Panoları Örneği)
    let pos = (await client.query("SELECT id, current_version FROM positions WHERE organization_id = $1 AND title = 'Veri Analisti'", [orgId])).rows[0];
    let posId: string;
    if (!pos) {
      posId = newId();
      await client.query(`
        INSERT INTO positions (id, organization_id, title, description, status, current_version, created_by_user_id)
        VALUES ($1, $2, 'Veri Analisti', 'Finansal ve operasyonel verileri modelleyebilen, PostgreSQL/SQL indeksleme ve optimizasyonuna hakim, Python veri analitiği kütüphaneleriyle (Pandas, NumPy) analitik modeller geliştirecek takım arkadaşı arıyoruz.', 'active', 1, $3)
      `, [posId, orgId, userMap.admin]);

      await client.query(`
        INSERT INTO position_versions (position_id, organization_id, version_no, title, description, created_by_user_id)
        VALUES ($1, $2, 1, 'Veri Analisti', 'Finansal ve operasyonel verileri modelleyebilen veri analisti arayışı.', $3)
      `, [posId, orgId, userMap.admin]);
    } else {
      posId = pos.id;
      await client.query("UPDATE positions SET status = 'active' WHERE id = $1", [posId]);
    }

    // Pozisyon Gereksinimleri (%40 Python, %30 SQL, %30 Problem Çözme - Toplam %100)
    await client.query('DELETE FROM position_requirements WHERE position_id = $1', [posId]);
    const reqPythonId = newId();
    const reqSqlId = newId();
    const reqProblemId = newId();

    await client.query(`
      INSERT INTO position_requirements (id, organization_id, position_id, version_no, label, required, weight, sort_order)
      VALUES 
        ($1, $4, $5, 1, 'Python ve Veri Analitiği', true, 40, 1),
        ($2, $4, $5, 1, 'SQL ve Veritabanı Optimizasyonu', true, 30, 2),
        ($3, $4, $5, 1, 'Problem Çözme ve Vaka Analizi', true, 30, 3)
    `, [reqPythonId, reqSqlId, reqProblemId, orgId, posId]);

    // 5. Mülakat ve Görev Planı (is_approved = true)
    const sampleQuestions = [
      {
        id: newId(),
        requirement_id: reqPythonId,
        requirement_label: 'Python ve Veri Analitiği',
        order: 1,
        question_text: 'Özgeçmişinizde yer alan finansal analiz projesinde, yüksek hacimli zaman serisi verilerini Pandas ve NumPy kullanarak nasıl işlediniz? Karşılaştığınız bellek ve performans darboğazlarını nasıl çözdünüz?',
        followup_template: 'Büyük veri çerçevelerinde vektörizasyon ve bellek ayak izini azaltmak için hangi yöntemleri uyguladınız?'
      },
      {
        id: newId(),
        requirement_id: reqSqlId,
        requirement_label: 'SQL ve Veritabanı Optimizasyonu',
        order: 2,
        question_text: 'Milyonlarca satırlık ilişkisel tablolarda karmaşık JOIN ve GROUP BY sorgularının yanıt sürelerini düşürmek için EXPLAIN ANALYZE çıktısını nasıl yorumlarsınız? Hangi indeksleme türlerini tercih ettiniz?',
        followup_template: 'B-Tree ve Hash indeksleri arasındaki seçim kriterleriniz ve composite index mimariniz nasıl kurgulandı?'
      },
      {
        id: newId(),
        requirement_id: reqProblemId,
        requirement_label: 'Problem Çözme ve Vaka Analizi',
        order: 3,
        question_text: 'Üretim ortamında veri tutarsızlığı veya beklenmeyen bir aykırı değer (anomaly) tespit edildiğinde kök neden analizini (root cause analysis) adım adım nasıl yürütürsünüz?',
        followup_template: 'Bu süreçte veri bütünlüğünü garanti etmek için hangi test ve doğrulama mekanizmalarını kurdunuz?'
      }
    ];

    const sampleTask = {
      title: 'Veri Analisti Uygulamalı SQL Değerlendirme Görevi',
      task_type: 'sql',
      instructions: 'Aşağıdaki müşteri sipariş verisi tablosunu inceleyin. Son 6 ayda toplam harcaması 1000 TL üzerinde olan ve 2 adetten fazla sipariş veren müşterilerin ID, isim, toplam sipariş sayısı ve ortalama sipariş tutarını getiren optimize SQL sorgusunu yazın.',
      initial_code: `-- Müşteri bazında son 6 aylık sipariş değerini getiren optimize sorgu
SELECT 
  c.id, 
  c.name,
  COUNT(o.id) as total_orders,
  AVG(o.amount) as avg_amount
FROM customers c
JOIN orders o ON o.customer_id = c.id
GROUP BY c.id, c.name
HAVING COUNT(o.id) > 2 AND AVG(o.amount) > 1000
ORDER BY avg_amount DESC;`,
      sample_data: [
        { id: 1, customer: 'Ahmet Yılmaz', total_orders: 5, avg_amount: 1450.50 },
        { id: 2, customer: 'Zeynep Kaya', total_orders: 8, avg_amount: 2300.00 },
        { id: 3, customer: 'Burak Demir', total_orders: 3, avg_amount: 890.20 }
      ]
    };

    await client.query(`
      INSERT INTO interview_plans (id, organization_id, position_id, position_version, rubric_version, questions, task_template, is_approved, approved_by_user_id, approved_at)
      VALUES ($1, $2, $3, 1, 1, $4, $5, true, $6, now())
      ON CONFLICT (id) DO UPDATE SET is_approved = true, questions = EXCLUDED.questions, task_template = EXCLUDED.task_template
    `, [newId(), orgId, posId, JSON.stringify(sampleQuestions), JSON.stringify(sampleTask), userMap.admin]);

    // 6. PDF Adayları ve Değerlendirmeleri (Deniz Yılmaz, Ayşe Yılmaz, Ece Demir, Can Kaya, Burak Demir, Selin Arslan)
    // Aday A: Deniz Yılmaz (Python: 85 %40, SQL: 60 %30, Problem: 80 %30 -> Genel Uyum = 76.0 - AC-11)
    const candDenizId = newId();
    await client.query(`
      INSERT INTO candidates (id, email, full_name) VALUES ($1, 'deniz.yilmaz@example.com', 'Deniz Yılmaz')
      ON CONFLICT (id) DO NOTHING
    `, [candDenizId]);

    const appDenizId = newId();
    await client.query(`
      INSERT INTO applications (id, organization_id, position_id, position_version, candidate_id, candidate_name, status)
      VALUES ($1, $2, $3, 1, $4, 'Deniz Yılmaz', 'completed')
      ON CONFLICT (position_id, candidate_id) DO UPDATE SET status = 'completed'
    `, [appDenizId, orgId, posId, candDenizId]);

    const sessDenizId = newId();
    await client.query(`
      INSERT INTO interview_sessions (id, organization_id, application_id, candidate_id, status, current_step, started_at, completed_at, duration_seconds, current_question_index)
      VALUES ($1, $2, $3, $4, 'completed', 'completed', now() - interval '2 days', now() - interval '2 days' + interval '35 minutes', 2100, 3)
      ON CONFLICT (application_id) DO NOTHING
    `, [sessDenizId, orgId, appDenizId, candDenizId]);

    // Deniz Yılmaz Transkript Turları
    const denizTurn1Id = newId();
    const denizTurn2Id = newId();
    await client.query(`
      INSERT INTO interview_turns (id, session_id, turn_number, speaker, requirement_id, question_text, transcript_text, audio_timestamp_start, audio_timestamp_end)
      VALUES 
        ($1, $2, 1, 'candidate', $3, 'Python ve Veri Analitiği', 'Finansal analiz projemde günlük 15 milyon satırlık hisse verilerini Pandas ile işlerken bellek tüketimini azaltmak için verileri chunk bazlı okuduk ve dtypes optimizasyonu yaparak RAM ayak izini %60 düşürdük.', 12.0, 32.0),
        ($4, $2, 2, 'candidate', $5, 'SQL ve Veritabanı Optimizasyonu', 'Sorgularda EXPLAIN kullanarak sequential scan yapılan tabloları tespit ettik. Tarih ve müşteri ID için bileşik B-Tree indeksi kurarak sorgu süresini 4.2 saniyeden 120 milisaniyeye indirdik.', 35.0, 58.0)
    `, [denizTurn1Id, sessDenizId, reqPythonId, denizTurn2Id, reqSqlId]);

    // Deniz Yılmaz Görev Teslimi
    await client.query(`
      INSERT INTO task_submissions (id, session_id, application_id, task_type, code_content, explanation_text, execution_output)
      VALUES ($1, $2, $3, 'sql', $4, 'CTE ve HAVING kullanarak son 6 ayı filtreledim, aggregate fonksiyonları indeksli alan üzerinden çalıştırdım.', '3 satır başarıyla döndürüldü. Testler başarılı.')
      ON CONFLICT (session_id) DO NOTHING
    `, [newId(), sessDenizId, appDenizId, sampleTask.initial_code]);

    // Deniz Yılmaz Puanları: 85 (%40) + 60 (%30) + 80 (%30) = 76.0
    await client.query('DELETE FROM assessments WHERE application_id = $1', [appDenizId]);
    const asmD1 = newId(), asmD2 = newId(), asmD3 = newId(), asmDOverall = newId();

    await client.query(`
      INSERT INTO assessments (id, organization_id, application_id, session_id, requirement_id, is_overall, score, weight, status, rationale, strengths, improvements)
      VALUES 
        ($1, $4, $5, $6, $7, false, 85, 40, 'completed', 'Python veri yapılarında bellek optimizasyonu ve chunk işleme yaklaşımı rubric seviyesiyle tam örtüşmektedir.', '["Pandas bellek optimizasyonu", "Chunk işleme tecrübesi"]', '["İleri seviye distributed computing (PySpark) eklenebilir"]'),
        ($2, $4, $5, $6, $8, false, 60, 30, 'completed', 'Temel indeksleme ve EXPLAIN ANALYZE kavramlarına hakim, ancak karmaşık partitioning senaryolarında ek yönlendirme gerekti.', '["B-Tree indeks kullanımı"]', '["Partitioning ve sharding optimizasyonu"]'),
        ($3, $4, $5, $6, $9, false, 80, 30, 'completed', 'Veri tutarsızlığı tespitinde analitik adımları sistematik olarak aktardı.', '["Sistematik kök neden analizi"]', '["Otomatik uyarı sistemleri tasarımı"]')
    `, [asmD1, asmD2, asmD3, orgId, appDenizId, sessDenizId, reqPythonId, reqSqlId, reqProblemId]);

    // AC-11 Doğrulaması: 85*0.40 + 60*0.30 + 80*0.30 = 76.0
    await client.query(`
      INSERT INTO assessments (id, organization_id, application_id, session_id, is_overall, score, weight, status, rationale, strengths, improvements)
      VALUES ($1, $2, $3, $4, true, 76.0, 100, 'completed', 'Tüm zorunlu yetkinlikler değerlendirilmiştir. Doğrulanmış genel uyum: %76.0 (85×0.40 + 60×0.30 + 80×0.30 = 76.0).', '["Güçlü Python veri analitiği", "Sistematik problem çözme yaklaşımı"]', '["İleri seviye SQL partitioning"]')
    `, [asmDOverall, orgId, appDenizId, sessDenizId]);

    await client.query(`
      INSERT INTO evidence_items (id, assessment_id, turn_id, video_timestamp_start, video_timestamp_end, quote, explanation)
      VALUES 
        ($1, $2, $3, 12.0, 32.0, '...günlük 15 milyon satırlık hisse verilerini Pandas ile işlerken dtypes optimizasyonu yaparak RAM ayak izini %60 düşürdük.', 'Python optimizasyonuna doğrudan kanıt.'),
        ($4, $5, $6, 35.0, 58.0, '...Tarih ve müşteri ID için bileşik B-Tree indeksi kurarak sorgu süresini 4.2 saniyeden 120 milisaniyeye indirdik.', 'SQL indeksleme yetkinliği kanıtı.')
    `, [newId(), asmD1, denizTurn1Id, newId(), asmD2, denizTurn2Id]);

    // Aday B: Ayşe Yılmaz (Python: 65 %40, SQL: 90 %30, Problem: 75 %30 -> Genel Uyum = 75.5 - PDF Sayfa 11)
    const candAyseId = newId();
    await client.query(`INSERT INTO candidates (id, email, full_name) VALUES ($1, 'ayse.yilmaz@example.com', 'Ayşe Yılmaz') ON CONFLICT (id) DO NOTHING`, [candAyseId]);
    const appAyseId = newId();
    await client.query(`
      INSERT INTO applications (id, organization_id, position_id, position_version, candidate_id, candidate_name, status)
      VALUES ($1, $2, $3, 1, $4, 'Ayşe Yılmaz', 'completed')
      ON CONFLICT (position_id, candidate_id) DO UPDATE SET status = 'completed'
    `, [appAyseId, orgId, posId, candAyseId]);

    const sessAyseId = newId();
    await client.query(`
      INSERT INTO interview_sessions (id, organization_id, application_id, candidate_id, status, current_step, started_at, completed_at, duration_seconds, current_question_index)
      VALUES ($1, $2, $3, $4, 'completed', 'completed', now() - interval '1 day', now() - interval '1 day' + interval '40 minutes', 2400, 3)
      ON CONFLICT (application_id) DO NOTHING
    `, [sessAyseId, orgId, appAyseId, candAyseId]);

    await client.query('DELETE FROM assessments WHERE application_id = $1', [appAyseId]);
    await client.query(`
      INSERT INTO assessments (id, organization_id, application_id, session_id, requirement_id, is_overall, score, weight, status, rationale, strengths, improvements)
      VALUES 
        ($1, $4, $5, $6, $7, false, 65, 40, 'completed', 'Python temelleri mevcut ancak derin veri bilimi optimizasyonunda ek tecrübe gerekmektedir.', '["Temel veri analizi bilgisi"]', '["Pandas bellek optimizasyonu"]'),
        ($2, $4, $5, $6, $8, false, 90, 30, 'completed', 'SQL ve veritabanı optimizasyonunda mükemmel performans gösterdi. İleri sorgulama tekniklerine hakim.', '["İleri seviye indeksleme", "Karmaşık JOIN optimizasyonu", "PostgreSQL tuning"]', '["NoSQL senaryoları"]'),
        ($3, $4, $5, $6, $9, false, 75, 30, 'completed', 'Vaka analizinde tutarlı çözümler sundu.', '["Yapılandırılmış analitik düşünce"]', '["Hızlı karar alma"]')
    `, [newId(), newId(), newId(), orgId, appAyseId, sessAyseId, reqPythonId, reqSqlId, reqProblemId]);

    // PDF Sayfa 11 Formülü: 65×0.40 + 90×0.30 + 75×0.30 = 26 + 27 + 22.5 = 75.5
    await client.query(`
      INSERT INTO assessments (id, organization_id, application_id, session_id, is_overall, score, weight, status, rationale, strengths, improvements)
      VALUES ($1, $2, $3, $4, true, 75.5, 100, 'completed', 'Tüm zorunlu yetkinlikler değerlendirilmiştir. Doğrulanmış genel uyum: %75.5 (65×0.40 + 90×0.30 + 75×0.30 = 75.5).', '["Mükemmel SQL ve indeksleme", "Veri ambarı mimarisi"]', '["Python derinleşmesi"]')
    `, [newId(), orgId, appAyseId, sessAyseId]);

    // Aday C: Ece Demir (İtiraz İncelemede - B09)
    const candEceId = newId();
    await client.query(`INSERT INTO candidates (id, email, full_name) VALUES ($1, 'ece.demir@example.com', 'Ece Demir') ON CONFLICT (id) DO NOTHING`, [candEceId]);
    const appEceId = newId();
    await client.query(`
      INSERT INTO applications (id, organization_id, position_id, position_version, candidate_id, candidate_name, status)
      VALUES ($1, $2, $3, 1, $4, 'Ece Demir', 'disputed')
      ON CONFLICT (position_id, candidate_id) DO UPDATE SET status = 'disputed'
    `, [appEceId, orgId, posId, candEceId]);

    const sessEceId = newId();
    await client.query(`
      INSERT INTO interview_sessions (id, organization_id, application_id, candidate_id, status, current_step, started_at, completed_at, duration_seconds)
      VALUES ($1, $2, $3, $4, 'submitted', 'completed', now() - interval '6 hours', now() - interval '5 hours', 1900)
      ON CONFLICT (application_id) DO NOTHING
    `, [sessEceId, orgId, appEceId, candEceId]);

    await client.query('DELETE FROM assessments WHERE application_id = $1', [appEceId]);
    await client.query(`
      INSERT INTO assessments (id, organization_id, application_id, session_id, is_overall, score, weight, status, rationale, strengths, improvements)
      VALUES ($1, $2, $3, $4, true, 71.5, 100, 'completed', 'Genel uyum skoru %71.5 olarak hesaplanmıştır.', '["Dengeli analitik yaklaşım"]', '["Büyük veri işleme"]')
    `, [newId(), orgId, appEceId, sessEceId]);

    // Ece Demir İtiraz Başvurusu
    await client.query('DELETE FROM appeals WHERE application_id = $1', [appEceId]);
    await client.query(`
      INSERT INTO appeals (id, organization_id, application_id, candidate_id, reason, timestamp_reference, status)
      VALUES ($1, $2, $3, $4, 'SQL sorgu optimizasyonu bölümünde anlattığım composite index ve explain analizi detaylarının puanıma tam yansıtılmadığını düşünüyorum. Cevabımın yeniden dinlenmesini rica ederim.', '00:12:30', 'submitted')
    `, [newId(), orgId, appEceId, candEceId]);

    // Aday D: Burak Demir (C12 Kesinti Sonrası Kurtarma Senaryosu)
    const candBurakId = newId();
    await client.query(`INSERT INTO candidates (id, email, full_name) VALUES ($1, 'burak.demir@example.com', 'Burak Demir') ON CONFLICT (id) DO NOTHING`, [candBurakId]);
    const appBurakId = newId();
    await client.query(`
      INSERT INTO applications (id, organization_id, position_id, position_version, candidate_id, candidate_name, status)
      VALUES ($1, $2, $3, 1, $4, 'Burak Demir', 'in_progress')
      ON CONFLICT (position_id, candidate_id) DO UPDATE SET status = 'in_progress'
    `, [appBurakId, orgId, posId, candBurakId]);

    const sessBurakId = newId();
    await client.query(`
      INSERT INTO interview_sessions (id, organization_id, application_id, candidate_id, status, current_step, started_at, duration_seconds, current_question_index)
      VALUES ($1, $2, $3, $4, 'interrupted', 'interview', now() - interval '1 hour', 450, 2)
      ON CONFLICT (application_id) DO UPDATE SET status = 'interrupted', current_step = 'interview', current_question_index = 2
    `, [sessBurakId, orgId, appBurakId, candBurakId]);

    // Burak Demir Davet Kaydı (token ile giriş yapılabilmesi için)
    const invBurakId = newId();
    await client.query(`
      INSERT INTO invitations (id, organization_id, application_id, position_id, position_version, token_hash, estimated_minutes, expires_at, created_by_user_id, status, delivery_status)
      VALUES ($1, $2, $3, $4, 1, $5, 30, now() + interval '5 days', $6, 'prepared', 'accepted')
      ON CONFLICT (id) DO NOTHING
    `, [invBurakId, orgId, appBurakId, posId, invitationHash(invBurakId), userMap.admin]);

    // Burak Demir için kaydedilmiş 1. ve 2. soru cevapları
    await client.query(`
      INSERT INTO interview_turns (id, session_id, turn_number, speaker, requirement_id, question_text, transcript_text, audio_timestamp_start, audio_timestamp_end)
      VALUES 
        ($1, $2, 1, 'candidate', $3, 'Python ve Veri Analitiği', 'Python kütüphaneleri ile veri temizleme ve ETL adımlarını başarıyla tamamladım.', 5.0, 22.0),
        ($4, $2, 2, 'candidate', $5, 'SQL ve Veritabanı Optimizasyonu', 'İlişkisel veritabanında normalize tablolar üzerinde sorgularımı çalıştırdım.', 25.0, 48.0)
      ON CONFLICT (id) DO NOTHING
    `, [newId(), sessBurakId, reqPythonId, newId(), reqSqlId]);

    // Aday E: Selin Arslan (AC-07: Eksik Kanıt - Puan Null)
    const candSelinId = newId();
    await client.query(`INSERT INTO candidates (id, email, full_name) VALUES ($1, 'selin.arslan@example.com', 'Selin Arslan') ON CONFLICT (id) DO NOTHING`, [candSelinId]);
    const appSelinId = newId();
    await client.query(`
      INSERT INTO applications (id, organization_id, position_id, position_version, candidate_id, candidate_name, status)
      VALUES ($1, $2, $3, 1, $4, 'Selin Arslan', 'review')
      ON CONFLICT (position_id, candidate_id) DO UPDATE SET status = 'review'
    `, [appSelinId, orgId, posId, candSelinId]);

    const sessSelinId = newId();
    await client.query(`
      INSERT INTO interview_sessions (id, organization_id, application_id, candidate_id, status, current_step, started_at, completed_at, duration_seconds)
      VALUES ($1, $2, $3, $4, 'submitted', 'completed', now() - interval '3 hours', now() - interval '2 hours', 1200)
      ON CONFLICT (application_id) DO NOTHING
    `, [sessSelinId, orgId, appSelinId, candSelinId]);

    await client.query('DELETE FROM assessments WHERE application_id = $1', [appSelinId]);
    // AC-07 Kuralı: Eksik zorunlu yetkinlik varsa genel puan null olmalı!
    await client.query(`
      INSERT INTO assessments (id, organization_id, application_id, session_id, requirement_id, is_overall, score, weight, status, rationale, strengths, improvements)
      VALUES 
        ($1, $4, $5, $6, $7, false, 80, 40, 'completed', 'Python temelleri değerlendirildi.', '["Temiz kod"]', '["Optimizasyon"]'),
        ($2, $4, $5, $6, $8, false, null, 30, 'incomplete_evidence', 'Ağ kesintisi nedeniyle SQL yetkinliğine ait soru cevaplanamadı.', '[]', '["SQL değerlendirmesi yapılmalıdır"]'),
        ($3, $4, $5, $6, $9, false, 70, 30, 'completed', 'Problem çözme değerlendirildi.', '["Analitik yaklaşım"]', '["Hız"]')
    `, [newId(), newId(), newId(), orgId, appSelinId, sessSelinId, reqPythonId, reqSqlId, reqProblemId]);

    await client.query(`
      INSERT INTO assessments (id, organization_id, application_id, session_id, is_overall, score, weight, status, rationale, strengths, improvements)
      VALUES ($1, $2, $3, $4, true, null, 100, 'incomplete_evidence', 'Eksik kanıt bulunan zorunlu yetkinlikler olduğundan genel puan hesaplanmamıştır (AC-07 kuralı).', '[]', '["Eksik yetkinlik için tamamlayıcı mülakat yapılmalıdır"]')
    `, [newId(), orgId, appSelinId, sessSelinId]);

    // 7. Örnek Model Değerlendirme Geri Bildirimi (B10)
    await client.query(`
      INSERT INTO evaluation_feedbacks (id, organization_id, user_id, position_id, application_id, feedback_type, notes, status)
      VALUES ($1, $2, $3, $4, $5, 'scoring_accuracy', 'SQL yetkinliğinde CTE kullanan adaylara rubric puanlamasında ek derinlik katsayısı eklenmesi önerildi.', 'reviewed')
      ON CONFLICT (id) DO NOTHING
    `, [newId(), orgId, userMap.reviewer, posId, appDenizId]);

    // 8. Örnek Audit Logları
    await client.query(`
      INSERT INTO audit_logs (id, organization_id, user_id, action, entity_type, entity_id, new_values, rationale)
      VALUES 
        ($1, $2, $3, 'interview_plan_approved', 'position', $4, '{"is_approved": true}', 'Veri Analisti mülakat planı ve SQL görevi onaylandı.'),
        ($5, $2, $3, 'batch_invitations_sent', 'invitation', $4, '{"count": 4}', 'Veri analisti pozisyonu adaylarına mülakat davetleri iletildi.')
      ON CONFLICT (id) DO NOTHING
    `, [newId(), orgId, userMap.admin, posId, newId()]);

    console.log('✓ Atlas Teknoloji A.Ş., Veri Analisti pozisyonu, 5 aday, puanlar ve tam kanıtlı raporlar başarıyla yüklendi.');
  });
}

if (process.argv[1]?.endsWith('seed-pdf-demo.ts')) {
  seedPdfDemo().then(() => pool.end(), async e => {
    console.error(e);
    await pool.end();
    process.exitCode = 1;
  });
}
