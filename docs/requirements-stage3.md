# AI Mülakat ve Aday Değerlendirme Platformu — Aşama 3 ve Eksiksiz Kapsam Durumu

Kaynak: `AI_Mulakat_Platformu_Proje_Gereksinimleri_v1.pdf` (33 sayfa).

Bu belge, PDF şartnamesinde tanımlanan ekran envanteri (B01–B10, C01–C12), gereksinim kodları (AUTH, JOB, CV, INT, TASK, REP, APP, NFR) ve temel kabul senaryolarının (AC-01 – AC-15) projedeki güncel durumunu belgeler.

---

## 1. Ekran Envanteri Durumu

### Şirket Ekranları (B01–B10)
| Kod | Ekran Adı | PDF Açıklaması | Mevcut Durum | Uygulama Karşılığı |
|---|---|---|---|---|
| **B01** | Şirket Girişi | Kurumsal hesap, rol bazlı oturum | Tamamlandı | `client/main.tsx` (`Login`), `server/index.ts` |
| **B02** | Genel Bakış | Pozisyonlar, adaylar, mülakatlar, sayaçlar | Tamamlandı | `client/main.tsx` (`CompanyHome`) |
| **B03** | Pozisyon Oluştur / Düzenle | İş tanımı, zorunlu/tercih gereksinimler, %100 ağırlık | Tamamlandı | `client/main.tsx` (`NewPosition`, `EditPosition`, `PositionDetail`) |
| **B04** | Mülakat Planı | Soru/görev planı, kapsam eşleştirmesi, onay | Tamamlandı | `client/main.tsx` (`CompanyInterviewPlanView`), `server/stage3.ts` (`/api/company/positions/:id/plan`) |
| **B05** | CV Değerlendirme & Kriter Eşleştirme | CV analizi, uygunluk gerekçesi, insan incelemesi | Tamamlandı | `client/main.tsx` (`CompanyApplicationDetail`), `server/stage3.ts` (`/analyze-cv`) |
| **B06** | Davet ve Planlama | Alıcı, süre, son tarih, test/SMTP gönderimi | Tamamlandı | `client/main.tsx` (`CompanyInvitationPreview`), `server/stage2.ts` |
| **B07** | Aday Karşılaştırma | Artılar, eksiler, yetkinlik yüzdeleri, genel uyum | Tamamlandı | `client/main.tsx` (`CompanyComparisonView`), `server/stage3.ts` (`/comparison`) |
| **B08** | Mülakat Raporu & Kayıt | Ses/video simülasyonu, tam transkript, kanıtlı puanlar | Tamamlandı | `client/main.tsx` (`CompanyReportView`), `server/stage3.ts` (`/report`) |
| **B09** | İtiraz İnceleme | İtiraz kuyruğu, kanıt inceleme, insan kararı, revizyon | Tamamlandı | `client/main.tsx` (`CompanyAppealsView`), `server/stage3.ts` (`/appeals/:id/decide`) |
| **B10** | Ekip ve Ayarlar | Roller, yetkiler, geri bildirim, kayıt saklama politikası | Tamamlandı | `client/main.tsx` (`CompanySettingsView`), `server/stage3.ts` (`/team`, `/settings`, `/audit-logs`) |

### Aday Ekranları (C01–C12)
| Kod | Ekran Adı | PDF Açıklaması | Mevcut Durum | Uygulama Karşılığı |
|---|---|---|---|---|
| **C01** | E-posta ile Giriş | Şifresiz aday girişi | Tamamlandı | `client/main.tsx` (`Login kind="candidate"`) |
| **C02** | Kod Doğrulama | 6 haneli tek kullanımlık kod | Tamamlandı | `client/main.tsx` (`CandidateVerify`), `server/index.ts` |
| **C03** | Davet Kabul | Pozisyon, şirket, süre, son tarih | Tamamlandı | `client/main.tsx` (`CandidateInvitationView`), `server/stage2.ts` |
| **C04** | Davet Doğrulama | Davet e-postası doğrulama | Tamamlandı | Ortak `CandidateVerify` bileşeni |
| **C05** | Bilgilendirme Onayı | AI görüşmesi, kayıt ve teknik ilkeler | Tamamlandı | `CandidateInterviewRoom` (`step='briefing'`) |
| **C06** | Cihaz Kontrolü | Canlı kamera, mikrofon seviye ölçeri, hoparlör testi | Tamamlandı | `CandidateInterviewRoom` (`step='device_check'`) |
| **C07** | AI Mülakat Odası | Konferans sahnesi, sesli soru/cevap, transkript, takip soruları | Tamamlandı | `CandidateInterviewRoom` (`step='interview'`) |
| **C08** | Uygulamalı Görev | Pozisyona göre SQL / Kodlama, konsol çıktısı | Tamamlandı | `CandidateInterviewRoom` (`step='task'`) |
| **C09** | Tamamlanma | Teslim onayı ve sonraki adımlar | Tamamlandı | `CandidateInterviewRoom` (`step='completed'`) |
| **C10** | Başvuru Durumu | Başvuru listesi ve aşama takibi | Tamamlandı | `client/main.tsx` (`CandidateHome`, `CandidateApplicationDetail`) |
| **C11** | İtiraz Başvurusu | Gerekçeli itiraz, zaman referansı | Tamamlandı | `client/main.tsx` (`CandidateApplicationDetail` itiraz formu) |
| **C12** | Görüşmeye Devam | Kesinti sonrası son adımdan devam etme | Tamamlandı | `server/stage3.ts` oturum kurtarma, `CandidateInterviewRoom` |

---

## 2. Gereksinim Karşılama Matrisi

- **AUTH-01 – AUTH-07**: 6 haneli tek kullanımlık kod, 10 dk süre sonu, tek kullanım, 5 yanlış deneme sınırı, hesap varlığını açığa çıkarmama, rol bazlı şirket yetkilendirmesi (`admin`, `recruiter`, `reviewer`).
- **JOB-01 – JOB-04**: Başlık, iş tanımı, zorunlu/tercih edilen kriter ayrımı, toplam %100 ağırlık doğrulaması (`server/validation.ts`), sürümlü plan ve rubrik modeli (`interview_plans`).
- **CV-01 – CV-05**: PDF metin çıkarımı (`server/cv-analysis.ts`), gereksinim eşleştirme matrisi (Tam / Kısmi / Eksik), somut CV bölüm/sayfa alıntıları, bozuk veya kısa CV için `needs_review` toleransı (CV-04), CV uygunluğu ile mülakat puanının ayrı tutulması (CV-05).
- **INT-01 – INT-08**: Türkçe sesli mülakat (Web Speech API TTS/STT), CV projelerine özel soru üretimi (AC-04), dinamik takip soruları ("Adayı terletme" mimari derinleştirme), soruyu tekrar dinleme ve açıklama isteme butonları (INT-05), canlı kalan süre sayacı (INT-07), kesinti sonrası kaydedilen adımdan devam (INT-08).
- **TASK-01 – TASK-05**: Pozisyona göre SQL sorgulama veya algoritmik kodlama görevi, simüle edilmiş güvenli izole yürütme konsolu, çözüm açıklaması ve kodun kalıcı saklanması.
- **REP-01 – REP-06**: Tam soru-cevap transkripti, video/ses zaman damgası eşleştirmesi, kanıt referansları (`evidence_items`), eksik aralık tespiti, plan/model sürüm kaydı.
- **APP-01 – APP-07**: Adayın gerekçeli itirazı, yetkili insan ekibine atanması, gerekçeli puan revizyonu (`/revise`), eski/yeni değerlerin ve yapan kişinin `audit_logs` tablosunda saklanması.
- **NFR-01 – NFR-10**: Sade ve profesyonel arayüz (lacivert/slate/mavi), kontrast ve klavye uyumu, sunucu taraflı şirket izolasyonu (`organization_id`), süreli tokenler, model çıktılarında prompt injection izolasyonu, veri saklama politikası yapılandırması (B10).

---

## 3. Doğrulama ve Test Sonuçları

- `npm test`: 5/5 birim testi başarılı (AC-11 ağırlık formülü 76.0 doğrulaması, AC-07 eksik kanıt null politikası, CV-01/CV-04 analiz kuralları, AC-12 insan revizyonu denetim izi).
- `npm run build`: TypeScript ve Vite derlemesi sıfır hata ile tamamlandı.
