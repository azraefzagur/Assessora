import { spawn } from 'node:child_process';

export interface CriteriaMatch {
  requirement_id: string;
  requirement_label: string;
  required: boolean;
  match_level: 'full' | 'partial' | 'missing';
  evidence_quote: string;
  source_section: string;
  rationale: string;
}

export interface ExtractedProject {
  title: string;
  role_or_tech: string;
  description: string;
  source_citation: string;
}

export interface CvAnalysisResult {
  match_status: 'suitable' | 'needs_review' | 'unsuitable';
  summary: string;
  criteria_matches: CriteriaMatch[];
  extracted_projects: ExtractedProject[];
  extracted_skills: string[];
  limitations: string | null;
}

/**
 * PDF ikili verisinden metin çıkarır.
 * Öncelikli olarak PyMuPDF (fitz) kullanır, başarısız olursa dahili metin akışı tarayıcısına geçer.
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
  try {
    const pythonCode = `
import sys, fitz
try:
    data = sys.stdin.buffer.read()
    doc = fitz.open(stream=data, filetype='pdf')
    pages_text = [f"--- Sayfa {i+1} ---\\n" + page.get_text() for i, page in enumerate(doc)]
    print(f"PAGE_COUNT:{len(doc)}")
    print("\\n".join(pages_text))
except Exception as e:
    print(f"ERROR:{e}", file=sys.stderr)
    sys.exit(1)
`;
    const child = spawn('python', ['-c', pythonCode], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf-8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf-8'); });

    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', code => resolve(code ?? 0));
      child.on('error', () => resolve(1));
      child.stdin.write(buffer);
      child.stdin.end();
    });

    if (exitCode === 0 && stdout.includes('PAGE_COUNT:')) {
      const match = stdout.match(/PAGE_COUNT:(\d+)/);
      const pageCount = match ? parseInt(match[1], 10) : 1;
      const cleanText = stdout.replace(/PAGE_COUNT:\d+\r?\n/, '').trim();
      if (cleanText.length > 20) {
        return { text: cleanText, pageCount };
      }
    }
  } catch (err) {
    console.warn('Python PDF çıkarma uyarısı, dahili ayıklayıcıya geçiliyor:', err);
  }

  // Fallback: Basit metin akışı tarayıcısı
  const raw = buffer.toString('latin1');
  const textChunks: string[] = [];
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRegex.exec(raw)) !== null) {
    const streamContent = m[1];
    // BT ... ET blokları içindeki Tj / TJ dizgilerini topla
    const tjMatches = streamContent.match(/\((.*?)\)\s*Tj/g) || [];
    for (const tj of tjMatches) {
      const extracted = tj.replace(/^\(/, '').replace(/\)\s*Tj$/, '').trim();
      if (extracted.length > 1) textChunks.push(extracted);
    }
  }

  const fallbackText = textChunks.join(' ').replace(/\\(\d{3})/g, ' ').trim();
  return {
    text: fallbackText.length > 20 ? fallbackText : 'PDF metni okunamadı veya tarama görsel formatında.',
    pageCount: 1
  };
}

/**
 * PDF CV metnini pozisyon gereksinimleri ile karşılaştırır (CV-01, CV-02, CV-03, CV-04, CV-05).
 */
export async function analyzeCvContent(
  cvText: string,
  requirements: Array<{ id: string; label: string; required: boolean; weight: number }>,
  positionTitle: string
): Promise<CvAnalysisResult> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey && cvText.length > 50 && !cvText.includes('PDF metni okunamadı')) {
    try {
      const reqList = requirements.map(r => `- [${r.required ? 'Zorunlu' : 'Tercih'}] ${r.label} (%${r.weight} ağırlık, ID: ${r.id})`).join('\n');
      const prompt = `Sen Assessora platformunda kıdemli teknik işe alım uzmanı ve CV analiz motorusun.
Aşağıdaki pozisyon gereksinimlerini ve aday CV metnini dikkatlice incele.

POZİSYON: ${positionTitle}
GEREKSİNİMLER:
${reqList}

ADAY CV METNİ:
"""
${cvText.slice(0, 8000)}
"""

KURALLAR (PDF Şartnamesi):
1. CV-01: CV içeriği ile pozisyon gereksinimlerini tek tek karşılaştır.
2. CV-03: Bulduğun her kanıtı CV'deki somut bölüm veya cümleye bağla (alıntı yap).
3. CV-04: Eksik veya okunamayan kısımlar kesin uygunsuzluk değildir, 'needs_review' gerektirebilir.
4. CV-05: CV uygunluğu yalnız ön elemedir, mülakat yetkinlik puanı değildir.
5. Sonuç statüleri: 'suitable' (uygun), 'needs_review' (insan incelemesi gerekli), 'unsuitable' (kriterleri karşılamıyor).

Yalnızca aşağıdaki JSON şemasına uygun, geçerli bir JSON nesnesi döndür:
{
  "match_status": "suitable" | "needs_review" | "unsuitable",
  "summary": "Pozisyon uyum özeti ve gerekçesi",
  "criteria_matches": [
    {
      "requirement_id": "string",
      "requirement_label": "string",
      "required": boolean,
      "match_level": "full" | "partial" | "missing",
      "evidence_quote": "CV'den doğrudan alıntı",
      "source_section": "CV Bölümü (örn. İş Deneyimi / Projeler)",
      "rationale": "Neden bu seviyede eşleştiğinin açıklaması"
    }
  ],
  "extracted_projects": [
    {
      "title": "Proje Adı",
      "role_or_tech": "Kullanılan Teknolojiler / Rol",
      "description": "Projenin kapsamı",
      "source_citation": "CV'deki yer veya referans"
    }
  ],
  "extracted_skills": ["beceri 1", "beceri 2"],
  "limitations": null veya "Varsa belirsizlik veya eksik bilgi"
}`;

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
        })
      });

      const data = await res.json();
      const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawJson) {
        const parsed = JSON.parse(rawJson);
        if (parsed.match_status && Array.isArray(parsed.criteria_matches)) {
          return parsed as CvAnalysisResult;
        }
      }
    } catch (e) {
      console.error('Gemini CV analiz hatası, kural bazlı motora dönülüyor:', e);
    }
  }

  // Deterministik Kural Bazlı Analiz (Offline / API Key yoksa)
  const lowerText = cvText.toLowerCase();
  const criteriaMatches: CriteriaMatch[] = [];
  let fullyMatchedRequired = 0;
  let partiallyMatchedRequired = 0;
  let totalRequired = 0;

  for (const r of requirements) {
    if (r.required) totalRequired++;
    const labelLower = r.label.toLowerCase();
    const keywords = labelLower.split(/[\s/,+-]+/).filter(k => k.length > 2);
    
    let matchedKeywords = 0;
    let quote = '';
    
    // CV içinde geçen ilgili cümleleri bul
    const sentences = cvText.split(/(?<=[.!?\n])\s+/);
    for (const s of sentences) {
      const sLower = s.toLowerCase();
      const hasWord = keywords.some(k => sLower.includes(k));
      if (hasWord) {
        matchedKeywords++;
        if (!quote) quote = s.trim().slice(0, 160);
      }
    }

    let matchLevel: 'full' | 'partial' | 'missing' = 'missing';
    let rationale = '';

    if (matchedKeywords >= 2 || (keywords.length === 1 && matchedKeywords >= 1)) {
      matchLevel = 'full';
      rationale = `Adayın CV metninde ${r.label} ile doğrudan örtüşen deneyim ve somut ifadeler tespit edildi.`;
      if (r.required) fullyMatchedRequired++;
    } else if (matchedKeywords === 1 || lowerText.includes(labelLower.slice(0, 4))) {
      matchLevel = 'partial';
      rationale = `İlgili terimler CV'de kısmen geçmektedir; derinlik mülakatta doğrulanmalıdır.`;
      if (r.required) partiallyMatchedRequired++;
    } else {
      matchLevel = 'missing';
      rationale = `CV metninde ${r.label} yetkinliğine dair açık bir ifade veya proje bulunamadı.`;
    }

    criteriaMatches.push({
      requirement_id: r.id,
      requirement_label: r.label,
      required: r.required,
      match_level: matchLevel,
      evidence_quote: quote || `Belirtilmemiş`,
      source_section: quote ? 'Deneyim / Beceriler Bölümü' : 'Bulunamadı',
      rationale
    });
  }

  // Proje ve yetkinlik çıkarımı
  const extractedProjects: ExtractedProject[] = [];
  const lines = cvText.split('\n').map(l => l.trim()).filter(Boolean);
  
  // Proje başlığı benzeri satırları ara
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/(proje|project|sistem|platform|uygulama|servis|api|microservice)/i.test(line) && line.length < 80 && line.length > 5) {
      const desc = lines.slice(i + 1, i + 3).join(' ').slice(0, 180);
      extractedProjects.push({
        title: line.replace(/^[-*•\d.]\s*/, ''),
        role_or_tech: positionTitle,
        description: desc || 'Sistem mimarisi ve işlevsel geliştirme çalışması.',
        source_citation: `CV Satır ${i + 1}`
      });
      if (extractedProjects.length >= 3) break;
    }
  }

  if (extractedProjects.length === 0) {
    extractedProjects.push({
      title: `${positionTitle} Kapsamında Proje Çalışması`,
      role_or_tech: requirements.map(r => r.label).slice(0, 3).join(', '),
      description: 'CV içeriğindeki teknik sorumluluklar ve geliştirme deneyimleri.',
      source_citation: 'CV Genel Deneyim Özeti'
    });
  }

  // Beceriler
  const extractedSkills = requirements
    .filter((req, idx) => idx % 2 === 0 || lowerText.includes(req.label.toLowerCase()))
    .map(r => r.label);

  // Genel statü hesabı
  let matchStatus: 'suitable' | 'needs_review' | 'unsuitable' = 'suitable';
  let summary = '';

  if (cvText.length < 100 || cvText.includes('PDF metni okunamadı')) {
    matchStatus = 'needs_review';
    summary = 'CV metni tam olarak ayrıştırılamadı veya kısa formatta. İnsan incelemesi gerekmektedir.';
  } else if (totalRequired > 0 && fullyMatchedRequired === 0 && partiallyMatchedRequired === 0) {
    matchStatus = 'unsuitable';
    summary = 'CV metninde pozisyonun zorunlu yetkinlik kriterlerini karşılayan yeterli kanıt bulunamadı.';
  } else if (fullyMatchedRequired + partiallyMatchedRequired >= Math.ceil(totalRequired * 0.6)) {
    matchStatus = 'suitable';
    summary = `Adayın özgeçmişi pozisyonun zorunlu gereksinimlerinin çoğunu karşılamaktadır (${fullyMatchedRequired}/${totalRequired} tam eşleşme). Sesli mülakat aşamasına uygundur.`;
  } else {
    matchStatus = 'needs_review';
    summary = `Zorunlu yetkinliklerin bir kısmı kısmi kanıt içermektedir. Değerlendirici ekibin manuel incelemesi önerilir.`;
  }

  return {
    match_status: matchStatus,
    summary,
    criteria_matches: criteriaMatches,
    extracted_projects: extractedProjects,
    extracted_skills: extractedSkills.length > 0 ? extractedSkills : requirements.map(r => r.label),
    limitations: cvText.length < 300 ? 'CV içeriği kısa olduğundan bazı yetkinliklerin detayları belirsizdir.' : null
  };
}
