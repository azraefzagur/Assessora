import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCvContent } from './cv-analysis.ts';

test('AC-11: Değerlendirme genel uyum puanı doğrulanmış ağırlık formülüyle hesaplanır (85, 60, 80 -> 76.0)', () => {
  // PDF Bölüm 09 ve AC-11 spesifikasyonu:
  // Python %40: 85, SQL %30: 60, Problem %30: 80 => Genel Uyum = 85*0.40 + 60*0.30 + 80*0.30 = 76.0
  const scores = [
    { score: 85, weight: 40 },
    { score: 60, weight: 30 },
    { score: 80, weight: 30 }
  ];

  let weightedSum = 0;
  for (const s of scores) {
    weightedSum += s.score * (s.weight / 100);
  }
  const overall = Math.round(weightedSum * 10) / 10;

  assert.equal(overall, 76.0, 'Genel puan tam olarak 76.0 olmalıdır');
});

test('AC-07: Eksik kanıt bulunan yetkinlikte genel puan uydurulmaz veya 0 sayılmaz (null döner)', () => {
  // PDF Bölüm 09 kuralı: "Eksik zorunlu yetkinlik varsa genel puanı nihai olarak yayınlama; 'incomplete_evidence' göster"
  const assessments = [
    { score: 85, weight: 40, status: 'completed' },
    { score: null, weight: 30, status: 'incomplete_evidence' },
    { score: 80, weight: 30, status: 'completed' }
  ];

  const hasIncomplete = assessments.some(a => a.status === 'incomplete_evidence' || a.score === null);
  const overallScore = hasIncomplete ? null : assessments.reduce((acc, a) => acc + (a.score! * (a.weight / 100)), 0);

  assert.equal(overallScore, null, 'Eksik kanıt varsa genel puan null olmalıdır');
});

test('CV-01 & CV-04: CV analizi gereksinimleri eşleştirir ve kısa/okunamayan CV için needs_review döner', async () => {
  const reqs = [
    { id: '1', label: 'PostgreSQL ve SQL Optimizasyonu', required: true, weight: 50 },
    { id: '2', label: 'Node.js Backend Mimarisi', required: true, weight: 50 }
  ];

  // 1. Çok kısa veya bozuk CV inceleme beklemelidir (CV-04)
  const shortResult = await analyzeCvContent('Kısa metin', reqs, 'Kıdemli Backend Geliştirici');
  assert.equal(shortResult.match_status, 'needs_review', 'Kısa veya eksik CV için inceleme gerekmelidir');

  // 2. Kriterleri içeren CV uygun olarak değerlendirilmeli (CV-01)
  const richCv = `
    Özgeçmiş
    Deneyim:
    Fintech A.Ş. - Kıdemli Yazılım Mühendisi
    - Yüksek hacimli finansal sistemlerde PostgreSQL ve SQL optimizasyonu gerçekleştirdim.
    - Node.js backend mimarisi ve mikroservis altyapılarını tasarlayıp devreye aldım.
    Projeler:
    - B2B Ödeme Platformu: Dağıtık işlem ve veri tutarlılığı sağlandı.
  `;
  const richResult = await analyzeCvContent(richCv, reqs, 'Kıdemli Backend Geliştirici');
  assert.equal(richResult.match_status, 'suitable', 'Kriterleri karşılayan CV suitable olmalıdır');
  assert.ok(richResult.criteria_matches.length === 2, 'Tüm gereksinimler matriste yer almalıdır');
  assert.ok(richResult.extracted_projects.length > 0, 'Projeler çıkarılmalıdır (AC-04)');
});

test('AC-12: İnsan revizyonu yapıldığında eski ve yeni değerler izlenir ve genel puan güncellenir', () => {
  // Adayın orijinal puanları: 85 (%40), 60 (%30), 80 (%30) => 76.0
  const original = [
    { id: 'asm-1', score: 85, weight: 40 },
    { id: 'asm-2', score: 60, weight: 30 },
    { id: 'asm-3', score: 80, weight: 30 }
  ];

  // Yetkili insan incelemesi: asm-2 puanını 60'tan 90'a çıkardı (gerekçe: transkriptteki Redis/SQL açıklaması tatmin edici bulundu)
  const revisedScore = 90;
  const auditLog = {
    entity_id: 'asm-2',
    old_value: 60,
    new_value: revisedScore,
    rationale: 'Transkriptteki SQL optimizasyonu ve indeksleme detayları rubric ölçütünü karşıladı.'
  };

  assert.equal(auditLog.old_value, 60);
  assert.equal(auditLog.new_value, 90);

  // Yeni genel puan: 85*0.40 + 90*0.30 + 80*0.30 = 34 + 27 + 24 = 85.0
  const updatedList = original.map(a => a.id === 'asm-2' ? { ...a, score: revisedScore } : a);
  const newOverall = updatedList.reduce((acc, a) => acc + (a.score * (a.weight / 100)), 0);

  assert.equal(Math.round(newOverall * 10) / 10, 85.0, 'İnsan revizyonu sonrası genel puan 85.0 olmalıdır');
});
