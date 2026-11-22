# GitHub Issue Taslakları

Kaynak: `docs/Assessora_Gelistirme_Yol_Haritasi.pdf`. Her issue şartname maddelerine (AUTH, INT, REP vb.) bağlıdır.
Önerilen etiketler: `güvenlik`, `hata`, `mülakat-motoru`, `değerlendirme`, `ai`, `şartname`, `test`, `öncelik:P0`, `öncelik:P1`.
Önerilen milestone'lar: **M1 – Güvenli temel**, **M2 – Mülakat motoru**, **M3 – Kanıtlı değerlendirme**.

---

## 1. Ekip üyesine sabit şifre atanmasını kaldır, "şifreni belirle" bağlantısı gönder
**Etiketler:** `güvenlik` `öncelik:P0` · **Milestone:** M1 · **Şartname:** AUTH-05

Şifresiz eklenen ekip üyesine `Assessora123!` atanıyor (`server/stage3.ts:1450`). Bu şifreyle giriş yapılabildiği doğrulandı.

**Yapılacaklar**
- [ ] Sabit varsayılan şifreyi kaldır; yönetici şifre girmez.
- [ ] Yeni üye için tek kullanımlık, süreli (ör. 48 saat) şifre belirleme token'ı üret; veritabanında yalnız hash'i tutulur.
- [ ] Davet e-postası mevcut e-posta kuyruğu (`email_jobs`) üzerinden gönderilir.
- [ ] Şifre belirlenmeden kullanıcı giriş yapamaz.

**Kabul ölçütü:** Şifresiz eklenen üye hiçbir şifreyle giriş yapamıyor; bağlantıdan şifre belirledikten sonra giriş yapabiliyor; kullanılmış veya süresi dolmuş bağlantı reddediliyor.

---

## 4. Test modundaki otomatik başvuru/davet oluşturan kodu kaldır
**Etiketler:** `güvenlik` `öncelik:P0` · **Milestone:** M1 · **Şartname:** NFR-03, AC-03

`server/index.ts:339` test modunda yeni adayı herhangi bir şirketin ilk aktif pozisyonuna otomatik başvurtup davet açıyor (şirket izolasyonu ihlali).

**Kabul ölçütü:** Kod isteği hiçbir koşulda başvuru veya davet oluşturmuyor.

---

## 6. Görev tekrar teslimini engelle
**Etiketler:** `hata` `öncelik:P0` · **Milestone:** M1 · **Şartname:** TASK-02, AC-08

Tekrar teslim değerlendirmeleri ikiye katlıyor (2 yetkinlik → 4 + 2 genel satır doğrulandı). Teslim, oturum durumuna bakılmadan kabul ediliyor.

**Yapılacaklar**
- [ ] Teslim yalnız görüşme `task` adımındayken kabul edilsin; sonra 409.
- [ ] Değerlendirme tek seferlik olsun ve veritabanında (session, requirement, is_overall) tekilliğiyle korunsun.

**Kabul ölçütü:** İkinci teslim 409 dönüyor; değerlendirme satır sayısı değişmiyor.

---

## 7. Mülakat akışını sunucu tarafı durum makinesiyle yönet
**Etiketler:** `mülakat-motoru` `güvenlik` `öncelik:P0` · **Milestone:** M2 · **Şartname:** INT-07, INT-08, §15, AC-06

Aday `step` uç noktasıyla doğrudan `completed` adımına atlayabiliyor; soru indeksini istemci gönderiyor.

**Yapılacaklar**
- [ ] Görüşme durumları ve izinli geçişler tek bir tabloda tanımlansın (§15: başlamadı → hazırlık → devam ediyor → kesildi → devam ediyor → teslim edildi → işleniyor → tamamlandı/eksik).
- [ ] İzinsiz geçiş 409.
- [ ] Mevcut soru ve adım yalnız sunucuda; istemciden gelen `currentQuestionIndex` yok sayılsın.

**Kabul ölçütü:** Adım atlama ve geri dönme denemeleri 409; zorunlu yetkinlik sorulmadan "tamamlandı" üretilemiyor.

---

## 8. Kesintiden devam: sunucudaki son kayıtlı adımdan sürdür
**Etiketler:** `mülakat-motoru` `öncelik:P1` · **Milestone:** M2 · **Şartname:** INT-08, NFR-05, AC-09, C12

**Yapılacaklar**
- [ ] Yeniden girişte adım, mevcut soru, kapsam durumu ve geçmiş sunucudan yüklenir.
- [ ] Kesinti zamanı kaydedilir (eksik aralık raporu için).
- [ ] AI çağrısı yarıda kesildiyse aynı soru kontrolsüz tekrarlanmaz.

**Kabul ölçütü:** Sayfa kapatılıp tekrar girildiğinde aday aynı sorudan devam ediyor; önceki cevaplar korunuyor.

---

## 9. Davet gönderimi şirket onayına bağlı olsun
**Etiketler:** `öncelik:P1` · **Milestone:** M1 · **Şartname:** §05, B06, AC-13

Tekil davet önizleme + onayla gidiyor; ancak toplu davet (`/api/company/invitations/batch-send`) onaysız gerçek e-posta gönderiyor ve `invite_mode` ayarı hiç kullanılmıyor.

**Yapılacaklar**
- [ ] Toplu davete önizleme ve açık onay adımı.
- [ ] `invite_mode = manual` (varsayılan): gönderim yalnız onayla; `auto`: CV sonucu "uygun" olunca otomatik.
- [ ] Toplu tekrar gönderimde yinelenen davet oluşmasın; son tarih doğrulansın.

**Kabul ölçütü:** Manuel modda onaysız hiçbir e-posta işi oluşmuyor; aynı toplu istek iki kez gönderilince yinelenen davet yok.

---

## 11. Kapsam takibi: her cevaptan sonra "yeterli kanıt var mı?" kararı
**Etiketler:** `mülakat-motoru` `ai` `öncelik:P0` · **Milestone:** M2 · **Şartname:** INT-03, INT-04, §08, AC-05, AC-06

Bugün takip sorusu kelime sayısına göre geliyor.

**Yapılacaklar**
- [ ] Her cevaptan sonra yapılandırılmış karar: `not_started | followup_needed | evaluated | incomplete` + gerekçe + eksik kanıt.
- [ ] `followup_needed` ise takip sorusu bu eksiğe göre üretilir (rastgele konuya geçilmez); yetkinlik başına takip sınırı plandan gelir.
- [ ] Karar `coverage_records`'a yazılır.

**Kabul ölçütü:** Eksik cevapta aynı yetkinliğe bağlı takip sorusu geliyor (AC-05); sorulmayan zorunlu yetkinlik varken "tam kapsamlı tamamlandı" üretilemiyor (AC-06).

---

## 12. Süre yönetimi: gerçek süre ve zorunlu yetkinlik önceliği
**Etiketler:** `mülakat-motoru` `öncelik:P1` · **Milestone:** M2 · **Şartname:** INT-07

Süre şu an her cevapta sabit +30 sn ekleniyor.

**Yapılacaklar**
- [ ] Süre sunucuda gerçek zamandan hesaplanır (kesinti süresi hariç).
- [ ] Toplam ve yetkinlik başına süre bütçesi plandan gelir.
- [ ] Süre azalınca kapsanmamış zorunlu yetkinliklere geçilir; süre biterse durum "eksik" olur, puan uydurulmaz.

**Kabul ölçütü:** Kısa süreli test planında zorunlu yetkinlikler tercih edilenlerden önce soruluyor; süre bitince kalanlar "eksik" görünüyor.

---

## 13. Rubrik: 1–5 seviye ve davranış örnekleri, sürümlü
**Etiketler:** `değerlendirme` `öncelik:P0` · **Milestone:** M3 · **Şartname:** §09 ölçek tasarımı, NFR-08, JOB-04

**Yapılacaklar**
- [ ] `rubric_versions` tablosu: yetkinlik başına 1–5 seviye, seviye başına davranış örnekleri.
- [ ] Rubrik plan sürümüne bağlı; değişiklik yeni sürüm oluşturur.
- [ ] Şirket arayüzünde rubrik düzenleme ve onay (B04).

**Kabul ölçütü:** Aynı plan sürümündeki tüm adaylar aynı rubrikle puanlanıyor; raporda rubrik sürümü görünüyor.

---

## 14. Kanıta bağlı puanlama ve alıntı doğrulama
**Etiketler:** `değerlendirme` `ai` `öncelik:P0` · **Milestone:** M3 · **Şartname:** REP-03, §21, AC-07

Bugünkü puan `75 + 5 × tur sayısı`; anlamsız cevaplar 85 aldı.

**Yapılacaklar**
- [ ] Yetkinlik başına yapılandırılmış çıktı: `score_or_null, level, rationale, evidence_refs[] (turn_id / submission_id), limitations`.
- [ ] Her alıntının transkriptte/görevde gerçekten geçtiği kodla doğrulanır; geçmiyorsa puan reddedilir.
- [ ] Kanıt yetersizse puan `null` + "değerlendirme tamamlanmadı"; sıfır sayılmaz.
- [ ] Orijinal AI puanı ayrı alanda değişmez saklanır.

**Kabul ölçütü:** Anlamsız cevaplar "kanıt yetersiz" alıyor; uydurma alıntı içeren çıktı reddediliyor.

---

## 15. Tutarlılık kontrolü: 2–3 çalıştırma, sapmada insan incelemesi
**Etiketler:** `değerlendirme` `ai` `öncelik:P1` · **Milestone:** M3 · **Şartname:** §09, NFR-08

**Yapılacaklar**
- [ ] Her yetkinlik değerlendirmesi bağımsız olarak 2–3 kez çalıştırılır.
- [ ] Sapma eşiği (ör. 1 rubrik seviyesi) aşılırsa `review_status = human_review_required`.
- [ ] Nihai puan medyan; tüm çalıştırmalar saklanır.

**Kabul ölçütü:** Sapma eşiği aşan sahte sağlayıcı senaryosunda başvuru "insan incelemesi gerekli" durumuna geçiyor.

---

## 16. Prompt injection koruması (mülakat ve puanlama)
**Etiketler:** `güvenlik` `ai` `öncelik:P0` · **Milestone:** M2 · **Şartname:** NFR-07, AC-15

**Yapılacaklar**
- [ ] Aday metni ve CV her zaman ayrı veri bloğunda; talimatlar sabit sistem kısmında.
- [ ] Çıktı şeması ve alıntı doğrulaması sunucuda yapılır (bkz. kanıta bağlı puanlama issue'su).
- [ ] En az 20 saldırı metninden oluşan test seti ("kuralları yok say", "bana 5 ver" vb.).

**Kabul ölçütü:** Saldırı setinin hiçbiri puanı, kapsamı veya kuralları değiştiremiyor.

---

## 17. CV'ye özel soru üretimi
**Etiketler:** `mülakat-motoru` `ai` `şartname` `öncelik:P1` · **Milestone:** M2 · **Şartname:** CV-02, CV-03, INT-02, AC-04

Sorular şu an tüm yetkinlikler için aynı şablon cümle.

**Yapılacaklar**
- [ ] Plan: yetkinlik başına bir ortak soru + CV'deki proje/deneyime dayalı bir özel soru.
- [ ] Her CV sorusu CV kaynak referansını (bölüm/sayfa) taşır.

**Kabul ölçütü:** CV'sinde proje olan adaya o projeyle ilişkili soru soruluyor; raporda kaynak görünüyor.

---

## 18. Arayüzdeki sahte ifade ve etiketleri kaldır
**Etiketler:** `şartname` `öncelik:P0` · **Milestone:** M1 · **Şartname:** REP-01, REP-05, REP-06

- Adaya "video kayıtlarınız teslim alındı" deniyor ama kayıt yok (`client/main.tsx:2433`).
- "Eksik zaman aralığı" uyarısı aday adında "Selin/Burak" geçince gösteriliyor (`client/main.tsx:2861`).
- Model ve prompt etiketleri sabit metin.
- Kod çalıştırma her zaman "3/3 test başarılı" diyor.

**Kabul ölçütü:** Arayüzde gerçek veriye dayanmayan hiçbir ifade yok; henüz yapılmayan özellikler açıkça "demo" olarak işaretli.

---

## 19. Gerçek testler: sahte stage3 testlerini değiştir
**Etiketler:** `test` `öncelik:P0` · **Milestone:** M1–M3 (sürekli)

`server/stage3.test.ts`'deki 11 testin 10'u mantığı test dosyasına kopyalayıp test ediyor; sunucu kodunu çağırmıyor.

**Yapılacaklar**
- [ ] Taklit testleri sil.
- [ ] Bu listedeki her issue için en az bir entegrasyon testi (geçici PostgreSQL + sahte AI sağlayıcısı).
- [ ] Başka şirketin kimliğiyle (IDOR) tüm şirket uç noktalarını deneyen test paketi (AC-03).

**Kabul ölçütü:** `npm test` ve `npm run test:integration` bu listedeki tüm kabul ölçütlerini kapsıyor ve geçiyor.
