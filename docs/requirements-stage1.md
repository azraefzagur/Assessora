# İlk aşama gereksinim eşlemesi

## İlk teslimde gerçekten kullanılan yığın

- Frontend: React yoktu; Express üzerinde `legacy/src/views.js` ile sunucuda oluşturulan HTML/CSS.
- Backend: Node.js ve Express 5, düz JavaScript (`legacy/src/server.js`).
- Veritabanı: SQLite; `better-sqlite3` ile hazırlanmış SQL sorguları ve SQL migration dosyaları. ORM yoktu.
- Oturum/yetki: Veritabanındaki `sessions` tablosu, HttpOnly/SameSite=Lax cookie, CSRF tokenı, scrypt şifre özeti; her istekte üyelik ve şirket/aday kimliği kontrolü.
- Test: Node.js `node:test` ve HTTP istekleri; önceki test `legacy/test/app.test.js`.

Tablodaki durumlar **önceki SQLite tesliminin** kapsamını belirtir. Yeni React/TypeScript/PostgreSQL kodu yerel PostgreSQL 18 üzerinde migration, aktarım, API entegrasyon ve Edge tarayıcı testleriyle doğrulandı. `legacy/src/` eski uygulamayı, `server/` ve `client/` yeni yolu gösterir.

| PDF gereksinimi / ilk aşama | Önceki durum | Mevcut kod ve sınır |
|---|---|---|
| B01 / şirket giriş ekranı, AUTH-05 hesaplı giriş | Çalışıyor | `legacy/src/server.js` şirket giriş rotaları, `legacy/src/security.js` şifre ve oturum; yeni karşılık `client/main.tsx` ve `server/index.ts`. |
| C01–C02 / aday e-posta ve kod ekranı, AUTH-01 | Kısmi | `legacy/src/server.js` kod üretimi/doğrulaması; gerçek e-posta yok, kod yalnız geliştirme terminalinde. Yeni karşılık `client/main.tsx`, `server/index.ts`. |
| AUTH-02 / tekrar aday girişi ve yalnız kendi başvuruları | Çalışıyor (test başvurusuyla) | `legacy/src/server.js` `/aday` sorgusu aday kimliğiyle sınırlandırılmış; yeni karşılık `/api/candidate/applications`. |
| AUTH-03 / süre, tekrar kullanım, deneme sınırı | Çalışıyor (SQLite) | `legacy/src/server.js` 10 dakika, tek kullanım, 5 deneme, 10 dakikada en çok 3 kod. Yeni karşılık `server/index.ts`; süre ve tek kullanım PostgreSQL testinde geçti. |
| AUTH-05 / rol bazlı şirket erişimi | Kısmi | `legacy/src/server.js` yönetici/işe alım yazabilir, değerlendirici okuyabilir. PDF’deki tam yetki matrisi ve nesne atamaları açık karar. Yeni karşılık `server/index.ts`. |
| AUTH-06 / çıkış ve yetki kaldırma | Kısmi | `legacy/src/server.js` çıkışta oturumu siler, üyeliği her istekte sorgular. Dağıtık hız sınırı ve kapsamlı oturum politikası yok. Yeni karşılık `server/index.ts`. |
| AUTH-07 / hesap varlığını gereksiz açığa çıkarmama | Kısmi | Aday kod isteği aynı yanıtı verir; şirket girişinde genel hata kullanılır. Zamanlama ve dağıtık hız sınırı sertleştirmesi eksik. |
| B02–B03 / şirket paneli, pozisyon oluşturma/listeleme | Çalışıyor | `legacy/src/server.js`, `legacy/src/views.js`; yeni karşılık `client/main.tsx`, `server/index.ts`. |
| C10 / aday paneli ve başvuru listesi | Kısmi | `legacy/src/server.js` yalnız geliştirme komutuyla oluşturulan başvuruları listeler. Gerçek davet/başvuru kaynağı yok. |
| JOB-01 / başlık, iş tanımı, yetkinlikler | Çalışıyor | `legacy/src/server.js` pozisyon formu; yeni doğrulama `server/validation.ts`. |
| JOB-02 / zorunlu ve tercih edilen kriter | Çalışıyor | `legacy/migrations/001_core.sql` ve pozisyon formu; yeni PostgreSQL karşılığı `pg-migrations/001_core.sql`. |
| JOB-03 / ağırlık toplamı %100 | Çalışıyor | `legacy/src/server.js` kayıt öncesi kontrol; yeni `server/validation.ts` testi. |
| JOB-04 / plan, rubrik ve ağırlık sürümleri | Eksik | Bu aşamada yalnız taslak pozisyon var; sürümleme sonraki değerlendirme aşamasında. |
| Şirket, kullanıcı, üyelik/rol, aday, pozisyon, başvuru modeli | Çalışıyor (SQLite) | `legacy/migrations/001_core.sql`; yeni şema `pg-migrations/001_core.sql` PostgreSQL 18'de uygulandı. |
| Şirket verisi izolasyonu, NFR-03’ün erişim kısmı | Çalışıyor (SQLite temel akışlar) | `legacy/src/server.js` sorgularında `organization_id`, `legacy/migrations/002_tenant_integrity.sql` tetikleyicileri; yeni PostgreSQL şemasında birleşik yabancı anahtarlar ve `server/index.ts` sorguları. PG entegrasyon testi geçti. |
| CV, davet, AI mülakatı, Zoom, avatar, video kaydı | Eksik | İlk çalışan aşamanın dışında; uygulanmış gibi gösterilmez. |

PDF’de K kabul edilmiş kapsamı, T uygulanması gereken türetilmiş gereksinimi, Ö öneriyi, A açık kararı belirtir. Görüşme ortamı, davet modu, sağlayıcılar, rubrik, CV kaynağı ve saklama politikası hâlâ açık karardır.

## Yeni uygulamanın doğrulanan karşılıkları

- Şirket girişi, pozisyon oluşturma/listeleme, aday giriş ekranı ve aday paneli Edge tarayıcı testinde geçti: `integration/browser.test.ts`.
- Şirketler arası veri sınırı, rol/yetki kaldırma, adayın yalnız kendi başvuruları, kodun süre/tek kullanımı, %100 ağırlık zorunluluğu ve üretimde geliştirme yollarının kapalı olması PostgreSQL API testinde geçti: `integration/postgres.test.ts`.
- Aktarılan yerel veritabanında 1 şirket, 1 kullanıcı, 1 üyelik bulunuyor; aday/pozisyon/başvuru kaydı kaynakta da yoktu. Tarayıcı testi bu veritabanına seed yapmadı.
- Gerçek e-posta ve PDF'deki sonraki aşama özellikleri hâlâ eksik.
