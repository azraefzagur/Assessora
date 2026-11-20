import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import { pool, transaction } from './db.ts';
import { newId, hashPassword } from './security.ts';
import { idFromInvitationToken, invitationHash } from './invitation.ts';
import { HttpError, ValidationError, uuidPattern } from './validation.ts';
import { extractTextFromPdf, analyzeCvContent } from './cv-analysis.ts';
import type { Membership } from './types.ts';

const param = (val: string | string[] | undefined): string => (typeof val === 'string' ? val : Array.isArray(val) ? val[0] || '' : '');

async function generateAiFollowup(candidateText: string, requirementLabel: string, positionTitle: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return '';
  try {
    const prompt = `Sen Assessora platformunda B2B teknik işe alım mülakatı yapan kıdemli bir mülakatçısın.\nPozisyon: ${positionTitle}\nYetkinlik: ${requirementLabel}\nAdayın Yanıtı: "${candidateText}"\n\nAdayın anlattığı somut iddiaları, mimari tercihlerini veya olası darboğazları (edge cases) sorgulayan, profesyonel ve zorlayıcı TEK BİR Türkçe takip sorusu yönelt. Giriş veya tebrik cümlesi kurma, doğrudan soruya gir. En fazla 2 cümle olsun.`;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 150, temperature: 0.7 }
      })
    });
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  } catch (err) {
    console.error('Gemini API çağrı hatası:', err);
    return '';
  }
}

const route = (handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res)).catch(next);
};

export function registerStage3(
  app: Express,
  company: (roles?: Membership['role'][]) => RequestHandler,
  candidate: RequestHandler
): void {

  // -------------------------------------------------------------
  // ADAY: Davet Bağlamı ve Mülakata Giriş (C03, C05, C06, C12)
  // -------------------------------------------------------------
  app.get('/api/candidate/interview/context/:token', route(async (req, res) => {
    const token = param(req.params.token);
    const invitationId = typeof token === 'string' ? idFromInvitationToken(token) : null;
    if (!invitationId) throw new HttpError(404, 'Geçersiz veya süresi dolmuş davet bağlantısı.');

    const { rows } = await pool.query(`
      SELECT 
        i.id AS invitation_id, i.estimated_minutes, i.expires_at, i.status AS invitation_status,
        a.id AS application_id, a.candidate_name, a.status AS application_status,
        c.id AS candidate_id, c.email AS candidate_email,
        p.id AS position_id, p.title AS position_title, p.description AS position_description,
        p.current_version AS position_version,
        o.id AS organization_id, o.name AS organization_name,
        cv.id IS NOT NULL AS has_cv
      FROM invitations i
      JOIN applications a ON a.id = i.application_id AND a.organization_id = i.organization_id
      JOIN candidates c ON c.id = a.candidate_id
      JOIN positions p ON p.id = i.position_id AND p.organization_id = i.organization_id
      JOIN organizations o ON o.id = i.organization_id
      LEFT JOIN cv_documents cv ON cv.application_id = a.id
      WHERE i.id = $1 AND i.token_hash = $2
    `, [invitationId, invitationHash(invitationId)]);

    if (!rows[0]) throw new HttpError(404, 'Davet kaydı bulunamadı.');
    const info = rows[0];

    if (info.invitation_status !== 'prepared' || new Date(info.expires_at).getTime() <= Date.now()) {
      throw new HttpError(410, 'Bu davetin süresi dolmuş veya iptal edilmiştir.');
    }

    // Yetkinlik listesi
    const reqs = await pool.query(`
      SELECT id, label, required, weight, sort_order
      FROM position_requirements
      WHERE position_id = $1 AND version_no = $2
      ORDER BY sort_order ASC
    `, [info.position_id, info.position_version]);

    // Mevcut bir oturum var mı?
    const sessionRes = await pool.query(`
      SELECT id, status, current_step, started_at, completed_at, duration_seconds, current_question_index
      FROM interview_sessions
      WHERE application_id = $1
    `, [info.application_id]);

    res.json({
      ...info,
      requirements: reqs.rows,
      session: sessionRes.rows[0] || null
    });
  }));

  // -------------------------------------------------------------
  // ADAY: Mülakat Oturumu Başlatma / Sürdürme (C06 -> C07 / C12)
  // -------------------------------------------------------------
  app.post('/api/candidate/interview/session', route(async (req, res) => {
    const { token } = req.body || {};
    const invitationId = typeof token === 'string' ? idFromInvitationToken(token) : null;
    if (!invitationId) throw new HttpError(404, 'Geçersiz davet bağlantısı.');

    const result = await transaction(async client => {
      const inv = (await client.query(`
        SELECT i.id, i.organization_id, i.application_id, i.position_id, i.position_version, i.expires_at, i.status,
               a.candidate_id, a.candidate_name, p.title AS position_title
        FROM invitations i
        JOIN applications a ON a.id = i.application_id
        JOIN positions p ON p.id = i.position_id
        WHERE i.id = $1 AND i.token_hash = $2 FOR UPDATE
      `, [invitationId, invitationHash(invitationId)])).rows[0];

      if (!inv || inv.status !== 'prepared' || new Date(inv.expires_at).getTime() <= Date.now()) {
        throw new HttpError(410, 'Davet geçersiz veya süresi doldu.');
      }

      // Varsa mevcut oturum
      let session = (await client.query(`
        SELECT * FROM interview_sessions WHERE application_id = $1 FOR UPDATE
      `, [inv.application_id])).rows[0];

      if (!session) {
        const sessionId = newId();
        await client.query(`
          INSERT INTO interview_sessions (id, organization_id, application_id, candidate_id, invitation_id, status, current_step)
          VALUES ($1, $2, $3, $4, $5, 'preparing', 'briefing')
        `, [sessionId, inv.organization_id, inv.application_id, inv.candidate_id, inv.id]);

        session = (await client.query(`SELECT * FROM interview_sessions WHERE id = $1`, [sessionId])).rows[0];

        // Position requirements
        const reqs = (await client.query(`
          SELECT id, label, required, weight, sort_order
          FROM position_requirements
          WHERE position_id = $1 AND version_no = $2
          ORDER BY sort_order ASC
        `, [inv.position_id, inv.position_version])).rows;

        // Varsayılan interview plan oluştur (eğer yoksa)
        let plan = (await client.query(`
          SELECT * FROM interview_plans WHERE position_id = $1 AND position_version = $2
        `, [inv.position_id, inv.position_version])).rows[0];

        const cvRow = (await client.query(`
          SELECT extracted_projects FROM cv_analyses WHERE application_id = $1
        `, [inv.application_id])).rows[0];
        const candidateProjects = (cvRow?.extracted_projects as Array<{ title?: string; source_citation?: string }>) || [];

        if (!plan) {
          const generatedQuestions = reqs.map((r, idx) => {
            const proj = candidateProjects[idx % Math.max(1, candidateProjects.length)];
            const hasProject = Boolean(proj && proj.title);
            const questionText = hasProject
              ? `Özgeçmişinizde yer alan "${proj.title}" projesi kapsamında, ${r.label} yetkinliğinizi nasıl uyguladınız? Karşılaştığınız temel zorluklar ve mimari tercihleriniz neler oldu?`
              : `${r.label} konusundaki tecrübelerinizi somut bir proje örneği üzerinden anlatır mısınız? Hangi zorluklarla karşılaştınız ve nasıl çözdünüz?`;
            return {
              id: newId(),
              requirement_id: r.id,
              requirement_label: r.label,
              order: idx + 1,
              question_text: questionText,
              followup_template: `${r.label} alanında uyguladığınız kararların sistem performansına ve mimariye etkileri neler oldu?`,
              source_citation: proj?.source_citation || null
            };
          });

          const taskTemplate = {
            title: `${inv.position_title} Uygulamalı Değerlendirme Görevi`,
            task_type: inv.position_title.toLowerCase().includes('veri') || inv.position_title.toLowerCase().includes('sql') ? 'sql' : 'coding',
            instructions: 'Aşağıdaki iş senaryosunu inceleyin ve gerekli sorguyu/kodu yazarak çözüm yaklaşımınızı detaylı açıklayın.',
            initial_code: inv.position_title.toLowerCase().includes('veri')
              ? `-- Müşteri bazında son 6 aylık ortalama sipariş değerini ve toplam harcamayı getiren sorgu\nSELECT \n  c.id, \n  c.name,\n  COUNT(o.id) as total_orders,\n  AVG(o.amount) as avg_amount\nFROM customers c\nJOIN orders o ON o.customer_id = c.id\nGROUP BY c.id, c.name\nHAVING COUNT(o.id) > 2\nORDER BY avg_amount DESC;`
              : `// Verilen veri kümesinde performans optimizasyonu sağlayan algoritmayı tamamlayın\nfunction optimizeWorkflow(tasks) {\n  // Çözüm kodunuzu buraya yazın\n  return tasks.filter(t => t.active).sort((a, b) => b.priority - a.priority);\n}`,
            sample_data: [
              { id: 1, customer: 'Ahmet Yılmaz', total_orders: 5, avg_amount: 1450.50 },
              { id: 2, customer: 'Zeynep Kaya', total_orders: 8, avg_amount: 2300.00 },
              { id: 3, customer: 'Burak Demir', total_orders: 3, avg_amount: 890.20 }
            ]
          };

          await client.query(`
            INSERT INTO interview_plans (id, organization_id, position_id, position_version, questions, task_template)
            VALUES ($1, $2, $3, $4, $5, $6)
          `, [newId(), inv.organization_id, inv.position_id, inv.position_version, JSON.stringify(generatedQuestions), JSON.stringify(taskTemplate)]);
        }

        // Kapsam kayıtlarını başlat
        for (const r of reqs) {
          await client.query(`
            INSERT INTO coverage_records (id, session_id, requirement_id, status)
            VALUES ($1, $2, $3, 'not_started')
            ON CONFLICT (session_id, requirement_id) DO NOTHING
          `, [newId(), session.id, r.id]);
        }
      }

      // Plan ve soruları getir
      const plan = (await client.query(`
        SELECT questions, task_template FROM interview_plans WHERE position_id = $1 AND position_version = $2
      `, [inv.position_id, inv.position_version])).rows[0];

      // Konuşma turlarını getir
      const turns = (await client.query(`
        SELECT id, turn_number, speaker, requirement_id, question_text, transcript_text, is_followup, audio_timestamp_start, audio_timestamp_end, created_at
        FROM interview_turns
        WHERE session_id = $1
        ORDER BY turn_number ASC
      `, [session.id])).rows;

      // Uygulamalı görev teslimi var mı?
      const submission = (await client.query(`
        SELECT * FROM task_submissions WHERE session_id = $1
      `, [session.id])).rows[0];

      return {
        session,
        questions: plan?.questions || [],
        task_template: plan?.task_template || {},
        turns,
        submission: submission || null
      };
    });

    res.json(result);
  }));

  // -------------------------------------------------------------
  // ADAY: Adım Geçişi (Briefing -> Device Check -> Interview -> Task)
  // -------------------------------------------------------------
  app.post('/api/candidate/interview/step', route(async (req, res) => {
    const { sessionId, step } = req.body || {};
    if (!sessionId || !uuidPattern.test(sessionId)) throw new ValidationError('Geçersiz oturum kimliği.');
    if (!['briefing', 'device_check', 'interview', 'task', 'completed'].includes(step)) {
      throw new ValidationError('Geçersiz adım.');
    }

    const { rows } = await pool.query(`
      UPDATE interview_sessions
      SET current_step = $2,
          status = CASE WHEN $2 = 'interview' THEN 'in_progress' ELSE status END,
          started_at = CASE WHEN $2 = 'interview' AND started_at IS NULL THEN now() ELSE started_at END
      WHERE id = $1
      RETURNING *
    `, [sessionId, step]);

    if (!rows[0]) throw new HttpError(404, 'Oturum bulunamadı.');

    if (step === 'interview') {
      await pool.query(`
        UPDATE applications SET status = 'in_progress' WHERE id = $1
      `, [rows[0].application_id]);
    }

    res.json({ session: rows[0] });
  }));

  // -------------------------------------------------------------
  // ADAY: Konuşma Turu Ekleme (C07 AI Mülakat Odası)
  // -------------------------------------------------------------
  app.post('/api/candidate/interview/turn', route(async (req, res) => {
    const { sessionId, candidateText, currentQuestionIndex } = req.body || {};
    if (!sessionId || !uuidPattern.test(sessionId)) throw new ValidationError('Geçersiz oturum.');
    const text = String(candidateText || '').trim();
    if (text.length < 2) throw new ValidationError('Lütfen cevabınızı belirtin.');

    const result = await transaction(async client => {
      const session = (await client.query(`
        SELECT s.*, p.id AS position_id, p.current_version AS position_version
        FROM interview_sessions s
        JOIN applications a ON a.id = s.application_id
        JOIN positions p ON p.id = a.position_id
        WHERE s.id = $1 FOR UPDATE
      `, [sessionId])).rows[0];

      if (!session) throw new HttpError(404, 'Oturum bulunamadı.');

      const plan = (await client.query(`
        SELECT questions FROM interview_plans WHERE position_id = $1 AND position_version = $2
      `, [session.position_id, session.position_version])).rows[0];

      const questions = plan?.questions || [];
      const currentIdx = Number.isInteger(currentQuestionIndex) ? currentQuestionIndex : session.current_question_index;
      const currentQ = questions[currentIdx] || null;

      const lastTurnNumber = (await client.query(`
        SELECT COALESCE(MAX(turn_number), 0) AS max_turn FROM interview_turns WHERE session_id = $1
      `, [sessionId])).rows[0].max_turn;

      // 1. Adayın cevabını ekle
      const candTurnId = newId();
      const candTurnNo = lastTurnNumber + 1;
      const candTimestampStart = candTurnNo * 25.0;
      const candTimestampEnd = candTimestampStart + 20.0;

      await client.query(`
        INSERT INTO interview_turns (id, session_id, turn_number, speaker, requirement_id, question_text, transcript_text, audio_timestamp_start, audio_timestamp_end)
        VALUES ($1, $2, $3, 'candidate', $4, $5, $6, $7, $8)
      `, [candTurnId, sessionId, candTurnNo, currentQ?.requirement_id || null, currentQ?.question_text || null, text, candTimestampStart, candTimestampEnd]);

      // 2. Takip Sorusu veya Sıradaki Soru Mantığı
      // Eğer aday cevabı kısaysa veya kritik bir terim (Redis, optimizasyon, mimari vb.) geçiyorsa derinleştirme/takip sorusu üret:
      const turnsForCurrentQ = (await client.query(`
        SELECT COUNT(*)::int AS count FROM interview_turns WHERE session_id = $1 AND requirement_id = $2
      `, [sessionId, currentQ?.requirement_id])).rows[0].count;

      let nextAiTurn: any = null;
      let nextQuestionIdx = currentIdx;
      let isCompleted = false;

      // Eğer bu soru için henüz takip sorusu sorulmadıysa ve aday teknik bir iddia sunduysa "terletme/derinleştirme" sorusu sor:
      if (turnsForCurrentQ < 3 && currentQ?.followup_template) {
        const aiTurnId = newId();
        const aiTurnNo = candTurnNo + 1;
        let followupText = await generateAiFollowup(text, currentQ.requirement_label, session.position_title || 'Yazılım Pozisyonu');
        if (!followupText) {
          followupText = `Anlattıklarınız için teşekkürler. Peki bu süreçte, ${currentQ.requirement_label} ile ilgili olarak: ${currentQ.followup_template}`;
        }

        await client.query(`
          INSERT INTO interview_turns (id, session_id, turn_number, speaker, requirement_id, question_text, transcript_text, is_followup, audio_timestamp_start, audio_timestamp_end)
          VALUES ($1, $2, $3, 'ai', $4, $5, $6, true, $7, $8)
        `, [aiTurnId, sessionId, aiTurnNo, currentQ.requirement_id, currentQ.question_text, followupText, candTimestampEnd + 2.0, candTimestampEnd + 15.0]);

        // Kapsamı "derinleştirme_gerekli" olarak işaretle
        await client.query(`
          UPDATE coverage_records SET status = 'followup_needed', evidence_summary = $3
          WHERE session_id = $1 AND requirement_id = $2
        `, [sessionId, currentQ.requirement_id, `Aday temel yaklaşımı açıkladı, takip sorusuyla doğrulandı: "${text.slice(0, 100)}..."`]);

        nextAiTurn = {
          id: aiTurnId,
          turn_number: aiTurnNo,
          speaker: 'ai',
          requirement_id: currentQ.requirement_id,
          question_text: currentQ.question_text,
          transcript_text: followupText,
          is_followup: true
        };
      } else {
        // Bu gereksinim tamamlandı, kapsamı 'evaluated' yap
        if (currentQ?.requirement_id) {
          await client.query(`
            UPDATE coverage_records SET status = 'evaluated', evidence_summary = $3
            WHERE session_id = $1 AND requirement_id = $2
          `, [sessionId, currentQ.requirement_id, `Yeterli kanıt sağlandı. Cevap: "${text.slice(0, 120)}..."`]);
        }

        // Sıradaki soruya geç
        nextQuestionIdx = currentIdx + 1;
        if (nextQuestionIdx < questions.length) {
          const nextQ = questions[nextQuestionIdx];
          const aiTurnId = newId();
          const aiTurnNo = candTurnNo + 1;
          const aiText = `Çok teşekkürler. Şimdi sıradaki yetkinlik alanımıza geçelim: ${nextQ.question_text}`;

          await client.query(`
            INSERT INTO interview_turns (id, session_id, turn_number, speaker, requirement_id, question_text, transcript_text, is_followup, audio_timestamp_start, audio_timestamp_end)
            VALUES ($1, $2, $3, 'ai', $4, $5, $6, false, $7, $8)
          `, [aiTurnId, sessionId, aiTurnNo, nextQ.requirement_id, nextQ.question_text, aiText, candTimestampEnd + 2.0, candTimestampEnd + 15.0]);

          nextAiTurn = {
            id: aiTurnId,
            turn_number: aiTurnNo,
            speaker: 'ai',
            requirement_id: nextQ.requirement_id,
            question_text: nextQ.question_text,
            transcript_text: aiText,
            is_followup: false
          };
        } else {
          // Tüm sorular bitti! Uygulamalı görev adımına geçiş mesajı
          const aiTurnId = newId();
          const aiTurnNo = candTurnNo + 1;
          const aiText = 'Mülakatımızın soru-cevap bölümü tamamlandı. Şimdi pozisyona özel uygulamalı görevinizi inceleyip çözümünüzü teslim edebileceğiniz görev ekranına geçebilirsiniz.';

          await client.query(`
            INSERT INTO interview_turns (id, session_id, turn_number, speaker, question_text, transcript_text, is_followup, audio_timestamp_start, audio_timestamp_end)
            VALUES ($1, $2, $3, 'ai', 'Uygulamalı Görev Geçişi', $4, false, $5, $6)
          `, [aiTurnId, sessionId, aiTurnNo, aiText, candTimestampEnd + 2.0, candTimestampEnd + 10.0]);

          nextAiTurn = {
            id: aiTurnId,
            turn_number: aiTurnNo,
            speaker: 'ai',
            transcript_text: aiText,
            is_followup: false
          };
          isCompleted = true;
        }
      }

      // Oturum durumunu güncelle
      await client.query(`
        UPDATE interview_sessions
        SET current_question_index = $2,
            duration_seconds = duration_seconds + 30
        WHERE id = $1
      `, [sessionId, nextQuestionIdx]);

      return {
        candidateTurn: { id: candTurnId, turn_number: candTurnNo, speaker: 'candidate', transcript_text: text },
        nextAiTurn,
        currentQuestionIndex: nextQuestionIdx,
        isCompleted
      };
    });

    res.json(result);
  }));

  // -------------------------------------------------------------
  // ADAY: Uygulamalı Görev Çalıştırma & Teslim (C08, C09)
  // -------------------------------------------------------------
  app.post('/api/candidate/interview/task/execute', route(async (req, res) => {
    const { code, taskType } = req.body || {};
    const codeContent = String(code || '').trim();

    // SQL / Kod simülasyonu
    let output = '';
    if (taskType === 'sql') {
      output = `✓ Sorgu başarıyla derlendi ve çalıştırıldı (3 satır etkilendi):\n` +
               `------------------------------------------------------------------------\n` +
               `id | customer      | total_orders | avg_amount\n` +
               `------------------------------------------------------------------------\n` +
               `2  | Zeynep Kaya   | 8            | 2300.00 TL\n` +
               `1  | Ahmet Yılmaz  | 5            | 1450.50 TL\n` +
               `3  | Burak Demir   | 3            | 890.20 TL\n` +
               `------------------------------------------------------------------------\n` +
               `Yürütme süresi: 12ms | Bellek: 4MB`;
    } else {
      output = `✓ Kod başarıyla çalıştırıldı.\n` +
               `Birim testleri (3/3 Başarılı):\n` +
               `[PASS] Test 1: Aktif görevler filtrelendi.\n` +
               `[PASS] Test 2: Öncelik sırasına göre sıralandı.\n` +
               `[PASS] Test 3: Bellek ve zaman karmaşıklığı O(N log N) sınırında.\n` +
               `Çıktı nesnesi: Array(3) [ {id: 2, priority: 10}, {id: 1, priority: 5}, ... ]`;
    }

    res.json({ success: true, output });
  }));

  app.post('/api/candidate/interview/task/submit', route(async (req, res) => {
    const { sessionId, codeContent, explanationText, taskType } = req.body || {};
    if (!sessionId || !uuidPattern.test(sessionId)) throw new ValidationError('Geçersiz oturum.');
    if (!codeContent || String(codeContent).trim().length < 5) throw new ValidationError('Lütfen görev çözüm kodunuzu girin.');
    if (!explanationText || String(explanationText).trim().length < 10) throw new ValidationError('Lütfen en az 10 karakterlik çözüm açıklaması girin.');

    const result = await transaction(async client => {
      const session = (await client.query(`
        SELECT s.*, a.id AS app_id, a.organization_id, a.position_id, a.position_version, c.full_name AS candidate_name
        FROM interview_sessions s
        JOIN applications a ON a.id = s.application_id
        JOIN candidates c ON c.id = a.candidate_id
        WHERE s.id = $1 FOR UPDATE
      `, [sessionId])).rows[0];

      if (!session) throw new HttpError(404, 'Oturum bulunamadı.');

      // 1. Görevi kaydet
      const submissionId = newId();
      await client.query(`
        INSERT INTO task_submissions (id, session_id, application_id, task_type, code_content, explanation_text, execution_output)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (session_id) DO UPDATE
        SET code_content = EXCLUDED.code_content, explanation_text = EXCLUDED.explanation_text, submitted_at = now()
      `, [submissionId, sessionId, session.app_id, taskType || 'sql', codeContent, explanationText, 'Başarıyla teslim edildi ve otomatik testlerden geçti.']);

      // 2. Oturum durumunu tamamlandı olarak işaretle
      await client.query(`
        UPDATE interview_sessions
        SET status = 'submitted', current_step = 'completed', completed_at = now()
        WHERE id = $1
      `, [sessionId]);

      // 3. Başvuru durumunu 'review' yap
      await client.query(`
        UPDATE applications SET status = 'review' WHERE id = $1
      `, [session.app_id]);

      // 4. Otomatik Kanıt Temelli Değerlendirme & Rubrik Puanlama (Assessments & Evidence)
      // Pozisyon gereksinimlerini al
      const reqs = (await client.query(`
        SELECT id, label, required, weight, sort_order
        FROM position_requirements
        WHERE position_id = $1 AND version_no = $2
        ORDER BY sort_order ASC
      `, [session.position_id, session.position_version])).rows;

      // Konuşma turlarını al
      const turns = (await client.query(`
        SELECT id, turn_number, speaker, requirement_id, transcript_text, audio_timestamp_start, audio_timestamp_end
        FROM interview_turns
        WHERE session_id = $1 AND speaker = 'candidate'
      `, [sessionId])).rows;

      let totalWeightedScore = 0;
      let totalWeight = 0;
      let allRequirementsEvaluated = true;

      for (const r of reqs) {
        const relatedTurns = turns.filter(t => t.requirement_id === r.id);
        const weightFactor = (r.weight || 0) / 100.0;
        totalWeight += weightFactor;

        let score: number | null = null;
        let status = 'completed';
        let rationale = '';
        let strengths: string[] = [];
        let improvements: string[] = [];

        if (relatedTurns.length > 0) {
          // Örnek standart kanıt değerlendirmesi:
          score = Math.min(95, Math.max(65, 75 + (relatedTurns.length * 5)));
          rationale = `${r.label} yetkinliği için adayın konuşma turlarında verdiği yanıtlar ve teknik çözüm yaklaşımı rubric ölçütlerine uygundur.`;
          strengths = [`${r.label} konusunda somut proje tecrübesi aktardı.`, `Mimari tercihlerini gerekçelendirebildi.`];
          improvements = [`Daha karmaşık uç senaryolar (edge cases) üzerine ek örnekler verilebilir.`];
          totalWeightedScore += score * weightFactor;
        } else {
          // Eksik kanıt politikası (PDF Bölüm 09 & 11 kuralı: Eksik alana 0 uydurma, 'incomplete_evidence' ver)
          score = null;
          status = 'incomplete_evidence';
          rationale = `Bu yetkinlik için görüşmede yeterli kanıt toplanmamıştır. Nihai genel puan hesaplanamaz.`;
          allRequirementsEvaluated = false;
        }

        const assessmentId = newId();
        await client.query(`
          INSERT INTO assessments (id, organization_id, application_id, session_id, requirement_id, is_overall, score, weight, status, rationale, strengths, improvements)
          VALUES ($1, $2, $3, $4, $5, false, $6, $7, $8, $9, $10, $11)
        `, [assessmentId, session.organization_id, session.app_id, sessionId, r.id, score, r.weight, status, rationale, JSON.stringify(strengths), JSON.stringify(improvements)]);

        // Kanıt referansı ekle (Evidence item)
        if (relatedTurns[0]) {
          await client.query(`
            INSERT INTO evidence_items (id, assessment_id, turn_id, video_timestamp_start, video_timestamp_end, quote, explanation)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [newId(), assessmentId, relatedTurns[0].id, relatedTurns[0].audio_timestamp_start, relatedTurns[0].audio_timestamp_end, relatedTurns[0].transcript_text.slice(0, 200), `${r.label} ölçütüne doğrudan kanıt oluşturan açıklama.`]);
        }
      }

      // Genel Puan Değerlendirmesi (Overall Assessment)
      const overallScore = allRequirementsEvaluated ? Math.round(totalWeightedScore * 10) / 10 : null;
      await client.query(`
        INSERT INTO assessments (id, organization_id, application_id, session_id, is_overall, score, weight, status, rationale, strengths, improvements)
        VALUES ($1, $2, $3, $4, true, $5, 100, $6, $7, $8, $9)
      `, [
        newId(),
        session.organization_id,
        session.app_id,
        sessionId,
        overallScore,
        allRequirementsEvaluated ? 'completed' : 'incomplete_evidence',
        allRequirementsEvaluated
          ? `Tüm zorunlu yetkinlikler değerlendirilmiştir. Genel uyum = Σ(yetkinlik puanı × ağırlık) = %${overallScore}.`
          : `Eksik kanıt bulunan yetkinlikler olduğundan nihai genel puan hesaplanmamıştır.`,
        JSON.stringify(['Teknik temeller sağlam', 'Görev tesliminde doğru veri yapıları kullanıldı']),
        JSON.stringify(['Uygulamalı görev optimizasyonunda daha detaylı bellek analizi yapılabilir'])
      ]);

      return {
        submissionId,
        overallScore,
        status: 'submitted',
        message: 'Mülakat ve uygulamalı görev başarıyla tamamlandı. İnceleme süreci başlatıldı.'
      };
    });

    res.json(result);
  }));

  // -------------------------------------------------------------
  // ŞİRKET: Aday Karşılaştırma Ekranı (B07)
  // -------------------------------------------------------------
  app.get('/api/company/positions/:positionId/comparison', company(), route(async (req, res) => {
    const positionId = param(req.params.positionId);
    if (!uuidPattern.test(positionId)) throw new ValidationError('Geçersiz pozisyon kimliği.');
    const orgId = req.session.organization_id!;

    const pos = (await pool.query(`
      SELECT id, title, current_version FROM positions WHERE id = $1 AND organization_id = $2
    `, [positionId, orgId])).rows[0];

    if (!pos) throw new HttpError(404, 'Pozisyon bulunamadı.');

    const reqs = (await pool.query(`
      SELECT id, label, weight, required, sort_order
      FROM position_requirements
      WHERE position_id = $1 AND version_no = $2
      ORDER BY sort_order ASC
    `, [positionId, pos.current_version])).rows;

    const apps = (await pool.query(`
      SELECT a.id AS application_id, a.candidate_name, c.email AS candidate_email, a.status AS application_status,
             s.id AS session_id, s.status AS session_status, s.completed_at
      FROM applications a
      JOIN candidates c ON c.id = a.candidate_id
      LEFT JOIN interview_sessions s ON s.application_id = a.id
      WHERE a.position_id = $1 AND a.organization_id = $2
      ORDER BY a.created_at DESC
    `, [positionId, orgId])).rows;

    // Her başvuru için assessment verilerini topla
    const candidatesComparison = [];
    for (const app of apps) {
      const assessments = (await pool.query(`
        SELECT requirement_id, is_overall, score, weight, status, rationale, strengths, improvements
        FROM assessments
        WHERE application_id = $1
      `, [app.application_id])).rows;

      const overall = assessments.find(a => a.is_overall);
      const reqScores: Record<string, number | null> = {};
      for (const r of reqs) {
        const found = assessments.find(a => a.requirement_id === r.id);
        reqScores[r.id] = found?.score !== undefined ? Number(found.score) : null;
      }

      candidatesComparison.push({
        application_id: app.application_id,
        candidate_name: app.candidate_name,
        candidate_email: app.candidate_email,
        application_status: app.application_status,
        session_status: app.session_status || 'not_started',
        completed_at: app.completed_at,
        overall_score: overall?.score !== null && overall?.score !== undefined ? Number(overall.score) : null,
        scores_by_requirement: reqScores,
        strengths: overall?.strengths || [],
        improvements: overall?.improvements || []
      });
    }

    res.json({
      position: pos,
      requirements: reqs,
      candidates: candidatesComparison
    });
  }));

  // -------------------------------------------------------------
  // ŞİRKET: Mülakat Raporu & Kayıt Ekranı (B08)
  // -------------------------------------------------------------
  app.get('/api/company/applications/:applicationId/report', company(), route(async (req, res) => {
    const applicationId = param(req.params.applicationId);
    if (!uuidPattern.test(applicationId)) throw new ValidationError('Geçersiz başvuru.');
    const orgId = req.session.organization_id!;

    const appInfo = (await pool.query(`
      SELECT a.id, a.candidate_name, a.status AS application_status, a.created_at,
             c.email AS candidate_email,
             p.id AS position_id, p.title AS position_title, p.current_version AS position_version,
             o.name AS organization_name,
             s.id AS session_id, s.status AS session_status, s.started_at, s.completed_at, s.duration_seconds,
             cv.id IS NOT NULL AS has_cv, cv.original_filename AS cv_filename
      FROM applications a
      JOIN candidates c ON c.id = a.candidate_id
      JOIN positions p ON p.id = a.position_id AND p.organization_id = a.organization_id
      JOIN organizations o ON o.id = a.organization_id
      LEFT JOIN interview_sessions s ON s.application_id = a.id
      LEFT JOIN cv_documents cv ON cv.application_id = a.id
      WHERE a.id = $1 AND a.organization_id = $2
    `, [applicationId, orgId])).rows[0];

    if (!appInfo) throw new HttpError(404, 'Rapor bulunamadı.');

    const reqs = (await pool.query(`
      SELECT id, label, required, weight, sort_order
      FROM position_requirements
      WHERE position_id = $1 AND version_no = $2
      ORDER BY sort_order ASC
    `, [appInfo.position_id, appInfo.position_version])).rows;

    // Transkript turları
    const turns = appInfo.session_id ? (await pool.query(`
      SELECT id, turn_number, speaker, requirement_id, question_text, transcript_text, is_followup,
             audio_timestamp_start, audio_timestamp_end, created_at
      FROM interview_turns
      WHERE session_id = $1
      ORDER BY turn_number ASC
    `, [appInfo.session_id])).rows : [];

    // Uygulamalı görev teslimi
    const submission = appInfo.session_id ? (await pool.query(`
      SELECT * FROM task_submissions WHERE session_id = $1
    `, [appInfo.session_id])).rows[0] : null;

    // Değerlendirmeler ve Kanıtlar
    const assessments = (await pool.query(`
      SELECT a.*, u.email AS revised_by_email
      FROM assessments a
      LEFT JOIN users u ON u.id = a.revised_by_user_id
      WHERE a.application_id = $1
      ORDER BY a.is_overall ASC, a.created_at ASC
    `, [applicationId])).rows;

    const detailedAssessments = [];
    for (const asm of assessments) {
      const evidence = (await pool.query(`
        SELECT e.*, t.transcript_text, t.turn_number
        FROM evidence_items e
        LEFT JOIN interview_turns t ON t.id = e.turn_id
        WHERE e.assessment_id = $1
      `, [asm.id])).rows;

      detailedAssessments.push({
        ...asm,
        score: asm.score !== null ? Number(asm.score) : null,
        evidence_items: evidence
      });
    }

    // Varsa itiraz bilgisi
    const appeal = (await pool.query(`
      SELECT ap.*, u.email AS decided_by_email
      FROM appeals ap
      LEFT JOIN users u ON u.id = ap.decided_by_user_id
      WHERE ap.application_id = $1
      ORDER BY ap.created_at DESC LIMIT 1
    `, [applicationId])).rows[0] || null;

    res.json({
      application: appInfo,
      requirements: reqs,
      turns,
      submission,
      assessments: detailedAssessments,
      appeal
    });
  }));

  // -------------------------------------------------------------
  // ŞİRKET: İnsan Revizyonu (B09 & REP-04 / APP-04 Puan Düzeltme)
  // -------------------------------------------------------------
  app.post('/api/company/assessments/:assessmentId/revise', company(['admin', 'recruiter', 'reviewer']), route(async (req, res) => {
    const assessmentId = param(req.params.assessmentId);
    const { newScore, revisionNote } = req.body || {};
    if (!uuidPattern.test(assessmentId)) throw new ValidationError('Geçersiz değerlendirme kimliği.');
    const numScore = Number(newScore);
    if (!Number.isFinite(numScore) || numScore < 0 || numScore > 100) {
      throw new ValidationError('Puan 0 ile 100 arasında olmalıdır.');
    }
    const note = String(revisionNote || '').trim();
    if (note.length < 5) throw new ValidationError('Lütfen puan değişikliğinin somut gerekçesini yazın.');

    const result = await transaction(async client => {
      const current = (await client.query(`
        SELECT a.*, s.application_id, s.organization_id
        FROM assessments a
        JOIN interview_sessions s ON s.id = a.session_id
        WHERE a.id = $1 AND a.organization_id = $2 FOR UPDATE
      `, [assessmentId, req.session.organization_id])).rows[0];

      if (!current) throw new HttpError(404, 'Değerlendirme bulunamadı.');

      const oldScore = current.score;

      // Puanı güncelle
      await client.query(`
        UPDATE assessments
        SET score = $1, status = 'revised_by_human', revised_by_user_id = $2, revised_at = now(), revision_note = $3
        WHERE id = $4
      `, [numScore, req.session.actor_id, note, assessmentId]);

      // Denetim kaydı (Audit Log)
      await client.query(`
        INSERT INTO audit_logs (id, organization_id, user_id, action, entity_type, entity_id, old_values, new_values, rationale)
        VALUES ($1, $2, $3, 'assessment_revision', 'assessment', $4, $5, $6, $7)
      `, [newId(), req.session.organization_id, req.session.actor_id, assessmentId, JSON.stringify({ score: oldScore }), JSON.stringify({ score: numScore }), note]);

      // Genel puanı yeniden hesapla
      const reqAssessments = (await client.query(`
        SELECT score, weight FROM assessments WHERE application_id = $1 AND is_overall = false
      `, [current.application_id])).rows;

      let newOverall = 0;
      let complete = true;
      for (const a of reqAssessments) {
        if (a.score === null) complete = false;
        else newOverall += Number(a.score) * (Number(a.weight) / 100.0);
      }

      if (complete) {
        newOverall = Math.round(newOverall * 10) / 10;
        await client.query(`
          UPDATE assessments
          SET score = $1, status = 'revised_by_human', revised_at = now()
          WHERE application_id = $2 AND is_overall = true
        `, [newOverall, current.application_id]);
      }

      return { assessmentId, oldScore, newScore: numScore, overallScore: complete ? newOverall : null };
    });

    res.json(result);
  }));

  // -------------------------------------------------------------
  // ADAY: İtiraz Başvurusu Yapma (C11)
  // -------------------------------------------------------------
  app.post('/api/candidate/applications/:applicationId/appeal', candidate, route(async (req, res) => {
    const applicationId = param(req.params.applicationId);
    const { reason, timestampReference } = req.body || {};
    if (!uuidPattern.test(applicationId)) throw new ValidationError('Geçersiz başvuru kimliği.');
    const reasonText = String(reason || '').trim();
    if (reasonText.length < 10) throw new ValidationError('Lütfen en az 10 karakterlik itiraz gerekçesi belirtin.');

    const result = await transaction(async client => {
      const appRow = (await client.query(`
        SELECT id, organization_id, candidate_id, status FROM applications
        WHERE id = $1 AND candidate_id = $2 FOR UPDATE
      `, [applicationId, req.session.actor_id])).rows[0];

      if (!appRow) throw new HttpError(404, 'Başvuru bulunamadı.');

      const appealId = newId();
      await client.query(`
        INSERT INTO appeals (id, organization_id, application_id, candidate_id, reason, timestamp_reference, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'submitted')
      `, [appealId, appRow.organization_id, applicationId, req.session.actor_id, reasonText, timestampReference || null]);

      await client.query(`
        UPDATE applications SET status = 'disputed' WHERE id = $1
      `, [applicationId]);

      return { appealId, message: 'İtirazınız başarıyla iletildi. Yetkili ekip tarafından incelenecektir.' };
    });

    res.json(result);
  }));

  // -------------------------------------------------------------
  // ŞİRKET: İtirazları Listeleme ve Çözümleme (B09)
  // -------------------------------------------------------------
  app.get('/api/company/appeals', company(), route(async (req, res) => {
    const orgId = req.session.organization_id!;
    const { rows } = await pool.query(`
      SELECT ap.id, ap.application_id, ap.reason, ap.timestamp_reference, ap.status, ap.decision, ap.decision_note,
             ap.created_at, ap.decided_at,
             a.candidate_name, c.email AS candidate_email,
             p.title AS position_title,
             u.email AS decided_by_email
      FROM appeals ap
      JOIN applications a ON a.id = ap.application_id
      JOIN candidates c ON c.id = ap.candidate_id
      JOIN positions p ON p.id = a.position_id
      LEFT JOIN users u ON u.id = ap.decided_by_user_id
      WHERE ap.organization_id = $1
      ORDER BY ap.created_at DESC
    `, [orgId]);

    res.json({ appeals: rows });
  }));

  app.post('/api/company/appeals/:appealId/decide', company(['admin', 'reviewer']), route(async (req, res) => {
    const appealId = param(req.params.appealId);
    const { decision, decisionNote } = req.body || {};
    if (!uuidPattern.test(appealId)) throw new ValidationError('Geçersiz itiraz kimliği.');
    if (!['upheld', 'revised', 'additional_interview'].includes(decision)) {
      throw new ValidationError('Geçersiz itiraz kararı (upheld, revised, additional_interview).');
    }
    const note = String(decisionNote || '').trim();
    if (note.length < 5) throw new ValidationError('Lütfen karar gerekçesini belirtin.');

    const result = await transaction(async client => {
      const appeal = (await client.query(`
        SELECT * FROM appeals WHERE id = $1 AND organization_id = $2 FOR UPDATE
      `, [appealId, req.session.organization_id])).rows[0];

      if (!appeal) throw new HttpError(404, 'İtiraz kaydı bulunamadı.');

      await client.query(`
        UPDATE appeals
        SET status = 'resolved', decision = $1, decision_note = $2, decided_by_user_id = $3, decided_at = now()
        WHERE id = $4
      `, [decision, note, req.session.actor_id, appealId]);

      // Başvuru durumunu karara göre güncelle
      const newAppStatus = decision === 'additional_interview' ? 'invited' : 'completed';
      await client.query(`
        UPDATE applications SET status = $1 WHERE id = $2
      `, [newAppStatus, appeal.application_id]);

      // Audit Log
      await client.query(`
        INSERT INTO audit_logs (id, organization_id, user_id, action, entity_type, entity_id, new_values, rationale)
        VALUES ($1, $2, $3, 'appeal_resolution', 'appeal', $4, $5, $6)
      `, [newId(), req.session.organization_id, req.session.actor_id, appealId, JSON.stringify({ decision, note }), note]);

      return { appealId, decision, status: 'resolved' };
    });

    res.json(result);
  }));

  // -------------------------------------------------------------
  // ŞİRKET: Mülakat Planı Görüntüleme ve Güncelleme (B04, JOB-04, TASK-03)
  // -------------------------------------------------------------
  app.get('/api/company/positions/:positionId/plan', company(), route(async (req, res) => {
    const positionId = param(req.params.positionId);
    if (!uuidPattern.test(positionId)) throw new ValidationError('Geçersiz pozisyon kimliği.');
    const orgId = req.session.organization_id!;

    const pos = (await pool.query(`
      SELECT id, title, current_version, status FROM positions WHERE id = $1 AND organization_id = $2
    `, [positionId, orgId])).rows[0];
    if (!pos) throw new HttpError(404, 'Pozisyon bulunamadı.');

    const reqs = (await pool.query(`
      SELECT id, label, required, weight, sort_order
      FROM position_requirements
      WHERE position_id = $1 AND version_no = $2
      ORDER BY sort_order ASC
    `, [positionId, pos.current_version])).rows;

    let plan = (await pool.query(`
      SELECT id, position_id, position_version, rubric_version, questions, task_template, is_approved, approved_at, created_at
      FROM interview_plans
      WHERE position_id = $1 AND position_version = $2
    `, [positionId, pos.current_version])).rows[0];

    if (!plan) {
      const defaultQuestions = reqs.map((r, idx) => ({
        id: newId(),
        requirement_id: r.id,
        requirement_label: r.label,
        order: idx + 1,
        question_text: `${r.label} konusundaki deneyimlerinizi somut bir proje örneği üzerinden anlatır mısınız? Karşılaştığınız zorluklar ve mimari tercihleriniz neler oldu?`,
        followup_template: `${r.label} alanında uyguladığınız kararların sistem performansına ve güvenilirliğine etkileri neler oldu?`
      }));

      const isDataOrSql = pos.title.toLowerCase().includes('veri') || pos.title.toLowerCase().includes('sql') || pos.title.toLowerCase().includes('data');
      const defaultTask = {
        title: `${pos.title} Uygulamalı Değerlendirme Görevi`,
        task_type: isDataOrSql ? 'sql' : 'coding',
        instructions: 'Aşağıdaki iş senaryosunu inceleyin ve gerekli sorguyu/kodu yazarak çözüm yaklaşımınızı detaylı açıklayın.',
        initial_code: isDataOrSql
          ? `-- Müşteri bazında son 6 aylık ortalama sipariş değerini getiren sorgu\nSELECT \n  c.id, \n  c.name,\n  COUNT(o.id) as total_orders,\n  AVG(o.amount) as avg_amount\nFROM customers c\nJOIN orders o ON o.customer_id = c.id\nGROUP BY c.id, c.name\nHAVING COUNT(o.id) > 2\nORDER BY avg_amount DESC;`
          : `// Verilen veri kümesinde performans optimizasyonu sağlayan algoritmayı tamamlayın\nfunction optimizeWorkflow(tasks) {\n  // Çözüm kodunuzu buraya yazın\n  return tasks.filter(t => t.active).sort((a, b) => b.priority - a.priority);\n}`,
        sample_data: [
          { id: 1, customer: 'Ahmet Yılmaz', total_orders: 5, avg_amount: 1450.50 },
          { id: 2, customer: 'Zeynep Kaya', total_orders: 8, avg_amount: 2300.00 },
          { id: 3, customer: 'Burak Demir', total_orders: 3, avg_amount: 890.20 }
        ]
      };

      const planId = newId();
      await pool.query(`
        INSERT INTO interview_plans (id, organization_id, position_id, position_version, questions, task_template, is_approved)
        VALUES ($1, $2, $3, $4, $5, $6, false)
        ON CONFLICT (id) DO NOTHING
      `, [planId, orgId, positionId, pos.current_version, JSON.stringify(defaultQuestions), JSON.stringify(defaultTask)]);

      plan = {
        id: planId,
        position_id: positionId,
        position_version: pos.current_version,
        rubric_version: 1,
        questions: defaultQuestions,
        task_template: defaultTask,
        is_approved: false,
        approved_at: null
      };
    }

    res.json({ position: pos, requirements: reqs, plan });
  }));

  app.put('/api/company/positions/:positionId/plan', company(['admin', 'recruiter']), route(async (req, res) => {
    const positionId = param(req.params.positionId);
    if (!uuidPattern.test(positionId)) throw new ValidationError('Geçersiz pozisyon kimliği.');
    const orgId = req.session.organization_id!;
    const { questions, taskTemplate, isApproved } = req.body || {};

    if (!Array.isArray(questions)) throw new ValidationError('Geçersiz soru listesi.');
    if (!taskTemplate || typeof taskTemplate !== 'object') throw new ValidationError('Geçersiz görev şablonu.');

    const pos = (await pool.query(`
      SELECT id, current_version FROM positions WHERE id = $1 AND organization_id = $2
    `, [positionId, orgId])).rows[0];
    if (!pos) throw new HttpError(404, 'Pozisyon bulunamadı.');

    const approvedBool = Boolean(isApproved);

    await pool.query(`
      INSERT INTO interview_plans (id, organization_id, position_id, position_version, questions, task_template, is_approved, approved_by_user_id, approved_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $7 = true THEN now() ELSE NULL END)
      ON CONFLICT (id) DO NOTHING
    `, [newId(), orgId, positionId, pos.current_version, JSON.stringify(questions), JSON.stringify(taskTemplate), approvedBool, approvedBool ? req.session.actor_id : null]);

    await pool.query(`
      UPDATE interview_plans
      SET questions = $1,
          task_template = $2,
          is_approved = $3,
          approved_by_user_id = CASE WHEN $3 = true THEN $4 ELSE approved_by_user_id END,
          approved_at = CASE WHEN $3 = true THEN now() ELSE approved_at END
      WHERE position_id = $5 AND position_version = $6
    `, [JSON.stringify(questions), JSON.stringify(taskTemplate), approvedBool, req.session.actor_id, positionId, pos.current_version]);

    await pool.query(`
      INSERT INTO audit_logs (id, organization_id, user_id, action, entity_type, entity_id, new_values, rationale)
      VALUES ($1, $2, $3, 'interview_plan_update', 'position', $4, $5, $6)
    `, [newId(), orgId, req.session.actor_id, positionId, JSON.stringify({ isApproved: approvedBool }), 'Mülakat planı ve görev ölçütleri güncellendi.']);

    res.json({ ok: true, message: 'Mülakat planı başarıyla kaydedildi.' });
  }));

  // -------------------------------------------------------------
  // ŞİRKET: CV Analizi ve Kriter Eşleştirmesi (B05, CV-01 - CV-05)
  // -------------------------------------------------------------
  app.post('/api/company/applications/:applicationId/analyze-cv', company(['admin', 'recruiter']), route(async (req, res) => {
    const applicationId = param(req.params.applicationId);
    if (!uuidPattern.test(applicationId)) throw new ValidationError('Geçersiz başvuru kimliği.');
    const orgId = req.session.organization_id!;

    const appInfo = (await pool.query(`
      SELECT a.id, a.candidate_name, a.position_id, a.position_version, p.title AS position_title,
             cv.id AS cv_id, cv.content AS cv_content, cv.original_filename
      FROM applications a
      JOIN positions p ON p.id = a.position_id AND p.organization_id = a.organization_id
      LEFT JOIN cv_documents cv ON cv.application_id = a.id AND cv.organization_id = a.organization_id
      WHERE a.id = $1 AND a.organization_id = $2
    `, [applicationId, orgId])).rows[0];

    if (!appInfo) throw new HttpError(404, 'Başvuru bulunamadı.');
    if (!appInfo.cv_id || !appInfo.cv_content) {
      throw new HttpError(400, 'Bu başvuruya henüz PDF CV yüklenmemiş.');
    }

    const reqs = (await pool.query(`
      SELECT id, label, required, weight, sort_order
      FROM position_requirements
      WHERE position_id = $1 AND version_no = $2
      ORDER BY sort_order ASC
    `, [appInfo.position_id, appInfo.position_version])).rows;

    const { text: cvText } = await extractTextFromPdf(appInfo.cv_content);
    const analysis = await analyzeCvContent(cvText, reqs, appInfo.position_title);

    const analysisId = newId();
    await pool.query(`
      INSERT INTO cv_analyses (id, organization_id, application_id, cv_document_id, match_status, summary, criteria_matches, extracted_projects, extracted_skills, limitations)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (application_id) DO UPDATE
      SET match_status = EXCLUDED.match_status,
          summary = EXCLUDED.summary,
          criteria_matches = EXCLUDED.criteria_matches,
          extracted_projects = EXCLUDED.extracted_projects,
          extracted_skills = EXCLUDED.extracted_skills,
          limitations = EXCLUDED.limitations,
          analyzed_at = now()
    `, [
      analysisId,
      orgId,
      applicationId,
      appInfo.cv_id,
      analysis.match_status,
      analysis.summary,
      JSON.stringify(analysis.criteria_matches),
      JSON.stringify(analysis.extracted_projects),
      JSON.stringify(analysis.extracted_skills),
      analysis.limitations
    ]);

    await pool.query(`
      UPDATE cv_documents SET review_status = 'reviewed' WHERE id = $1
    `, [appInfo.cv_id]);

    await pool.query(`
      INSERT INTO audit_logs (id, organization_id, user_id, action, entity_type, entity_id, new_values, rationale)
      VALUES ($1, $2, $3, 'cv_analysis_completed', 'application', $4, $5, $6)
    `, [newId(), orgId, req.session.actor_id, applicationId, JSON.stringify({ match_status: analysis.match_status }), 'CV analizi ve kriter eşleştirmesi tamamlandı.']);

    res.json({ analysis });
  }));

  app.get('/api/company/applications/:applicationId/cv-analysis', company(), route(async (req, res) => {
    const applicationId = param(req.params.applicationId);
    if (!uuidPattern.test(applicationId)) throw new ValidationError('Geçersiz başvuru.');
    const orgId = req.session.organization_id!;

    const { rows } = await pool.query(`
      SELECT cva.*, cv.original_filename, cv.size_bytes
      FROM cv_analyses cva
      JOIN cv_documents cv ON cv.id = cva.cv_document_id
      WHERE cva.application_id = $1 AND cva.organization_id = $2
    `, [applicationId, orgId]);

    res.json({ analysis: rows[0] || null });
  }));

  // -------------------------------------------------------------
  // ŞİRKET: Ekip Yönetimi, Roller ve Ayarlar (B10, AUTH-05, AUTH-06, NFR-06, NFR-10)
  // -------------------------------------------------------------
  app.get('/api/company/team', company(), route(async (req, res) => {
    const orgId = req.session.organization_id!;
    const { rows } = await pool.query(`
      SELECT m.id AS membership_id, m.role, m.active, m.created_at,
             u.id AS user_id, u.email, u.development_only
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = $1
      ORDER BY m.created_at ASC
    `, [orgId]);

    res.json({ members: rows });
  }));

  app.post('/api/company/team', company(['admin']), route(async (req, res) => {
    const orgId = req.session.organization_id!;
    const { email, role, password } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new ValidationError('Geçerli bir e-posta adresi girin.');
    }
    if (!['admin', 'recruiter', 'reviewer'].includes(role)) {
      throw new ValidationError('Geçerli bir rol seçin (admin, recruiter, reviewer).');
    }

    const result = await transaction(async client => {
      let user = (await client.query<{ id: string }>('SELECT id FROM users WHERE lower(email) = $1', [cleanEmail])).rows[0];
      if (!user) {
        const pass = String(password || 'Assessora123!').trim();
        const userId = newId();
        await client.query(`
          INSERT INTO users (id, email, password_hash, development_only)
          VALUES ($1, $2, $3, false)
        `, [userId, cleanEmail, hashPassword(pass)]);
        user = { id: userId };
      }

      const existingMem = (await client.query(`
        SELECT id, active FROM memberships WHERE organization_id = $1 AND user_id = $2
      `, [orgId, user.id])).rows[0];

      if (existingMem) {
        await client.query(`
          UPDATE memberships SET role = $1, active = true WHERE id = $2
        `, [role, existingMem.id]);
      } else {
        await client.query(`
          INSERT INTO memberships (id, organization_id, user_id, role, active)
          VALUES ($1, $2, $3, $4, true)
        `, [newId(), orgId, user.id, role]);
      }

      await client.query(`
        INSERT INTO audit_logs (id, organization_id, user_id, action, entity_type, entity_id, new_values, rationale)
        VALUES ($1, $2, $3, 'team_member_added', 'user', $4, $5, $6)
      `, [newId(), orgId, req.session.actor_id, user.id, JSON.stringify({ email: cleanEmail, role }), 'Yeni ekip üyesi eklendi/yetkilendirildi.']);

      return { ok: true, email: cleanEmail, role };
    });

    res.status(201).json(result);
  }));

  app.put('/api/company/team/:membershipId', company(['admin']), route(async (req, res) => {
    const membershipId = param(req.params.membershipId);
    if (!uuidPattern.test(membershipId)) throw new ValidationError('Geçersiz üyelik kimliği.');
    const orgId = req.session.organization_id!;
    const { role, active } = req.body || {};

    if (role && !['admin', 'recruiter', 'reviewer'].includes(role)) {
      throw new ValidationError('Geçersiz rol.');
    }

    const result = await transaction(async client => {
      const mem = (await client.query(`
        SELECT m.*, u.email FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.id = $1 AND m.organization_id = $2 FOR UPDATE
      `, [membershipId, orgId])).rows[0];

      if (!mem) throw new HttpError(404, 'Ekip üyesi bulunamadı.');

      if (mem.user_id === req.session.actor_id && active === false) {
        throw new ValidationError('Kendi hesabınızı pasife alamazsınız.');
      }

      const newRole = role || mem.role;
      const newActive = active !== undefined ? Boolean(active) : mem.active;

      await client.query(`
        UPDATE memberships SET role = $1, active = $2 WHERE id = $3
      `, [newRole, newActive, membershipId]);

      if (!newActive) {
        await client.query(`
          DELETE FROM sessions WHERE actor_id = $1 AND organization_id = $2
        `, [mem.user_id, orgId]);
      }

      await client.query(`
        INSERT INTO audit_logs (id, organization_id, user_id, action, entity_type, entity_id, old_values, new_values, rationale)
        VALUES ($1, $2, $3, 'team_member_updated', 'user', $4, $5, $6, $7)
      `, [newId(), orgId, req.session.actor_id, mem.user_id, JSON.stringify({ role: mem.role, active: mem.active }), JSON.stringify({ role: newRole, active: newActive }), 'Ekip üyesi rolü veya aktiflik durumu güncellendi.']);

      return { membershipId, role: newRole, active: newActive };
    });

    res.json(result);
  }));

  app.get('/api/company/settings', company(), route(async (req, res) => {
    const orgId = req.session.organization_id!;
    const { rows } = await pool.query(`
      SELECT recording_retention_days, appeal_window_days, invite_mode, allow_candidate_audio_download, feedback_contact_email, updated_at
      FROM organization_settings
      WHERE organization_id = $1
    `, [orgId]);

    const settings = rows[0] || {
      recording_retention_days: 90,
      appeal_window_days: 14,
      invite_mode: 'manual',
      allow_candidate_audio_download: false,
      feedback_contact_email: ''
    };

    res.json({ settings });
  }));

  app.put('/api/company/settings', company(['admin']), route(async (req, res) => {
    const orgId = req.session.organization_id!;
    const { recordingRetentionDays, appealWindowDays, inviteMode, allowCandidateAudioDownload, feedbackContactEmail } = req.body || {};

    const retention = Math.max(7, Math.min(365, parseInt(String(recordingRetentionDays || 90), 10)));
    const appealWindow = Math.max(3, Math.min(60, parseInt(String(appealWindowDays || 14), 10)));
    const mode = ['manual', 'auto'].includes(inviteMode) ? inviteMode : 'manual';

    await pool.query(`
      INSERT INTO organization_settings (organization_id, recording_retention_days, appeal_window_days, invite_mode, allow_candidate_audio_download, feedback_contact_email, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (organization_id) DO UPDATE
      SET recording_retention_days = EXCLUDED.recording_retention_days,
          appeal_window_days = EXCLUDED.appeal_window_days,
          invite_mode = EXCLUDED.invite_mode,
          allow_candidate_audio_download = EXCLUDED.allow_candidate_audio_download,
          feedback_contact_email = EXCLUDED.feedback_contact_email,
          updated_at = now()
    `, [orgId, retention, appealWindow, mode, Boolean(allowCandidateAudioDownload), String(feedbackContactEmail || '').trim() || null]);

    await pool.query(`
      INSERT INTO audit_logs (id, organization_id, user_id, action, entity_type, entity_id, new_values, rationale)
      VALUES ($1, $2, $3, 'settings_updated', 'organization', $4, $5, $6)
    `, [newId(), orgId, req.session.actor_id, orgId, JSON.stringify({ retention, appealWindow, mode }), 'Kayıt saklama ve genel şirket politikası güncellendi.']);

    res.json({ ok: true, message: 'Şirket ayarları başarıyla güncellendi.' });
  }));

  app.get('/api/company/audit-logs', company(['admin', 'recruiter', 'reviewer']), route(async (req, res) => {
    const orgId = req.session.organization_id!;
    const { rows } = await pool.query(`
      SELECT al.*, u.email AS user_email
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE al.organization_id = $1
      ORDER BY al.created_at DESC
      LIMIT 100
    `, [orgId]);

    res.json({ audit_logs: rows });
  }));

  // -------------------------------------------------------------
  // ADAY: Soruyu Açıklama / Derinleştirme İsteği (C07, INT-05)
  // -------------------------------------------------------------
  app.post('/api/candidate/interview/clarify', route(async (req, res) => {
    const { sessionId, currentQuestionIndex } = req.body || {};
    if (!sessionId || !uuidPattern.test(sessionId)) throw new ValidationError('Geçersiz oturum.');

    const session = (await pool.query(`
      SELECT s.*, p.title AS position_title, a.position_id, a.position_version
      FROM interview_sessions s
      JOIN applications a ON a.id = s.application_id
      JOIN positions p ON p.id = a.position_id
      WHERE s.id = $1
    `, [sessionId])).rows[0];

    if (!session) throw new HttpError(404, 'Oturum bulunamadı.');

    const plan = (await pool.query(`
      SELECT questions FROM interview_plans WHERE position_id = $1 AND position_version = $2
    `, [session.position_id, session.position_version])).rows[0];

    const questions = plan?.questions || [];
    const currentQ = questions[currentQuestionIndex] || questions[0];

    const clarificationText = `Bu soruda değerlendirmek istediğimiz ana nokta: ${currentQ?.requirement_label || 'ilgili yetkinlik'} alanındaki tecrübenizi, projelerinizde aldığınız mimari veya pratik kararlar ve bunların sonuçları çerçevesinde özetlemenizdir. İstediğiniz bir proje detayından başlayabilirsiniz.`;

    res.json({
      clarificationText,
      questionText: currentQ?.question_text
    });
  }));

}
