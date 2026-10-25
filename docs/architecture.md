# Mimari ve kapsam kaydı

Kaynak: `AI_Mulakat_Platformu_Proje_Gereksinimleri_v1.pdf`, 33 sayfa. Bu kayıt belge içindeki K (kabul edilen kapsam), T (türetilmiş gereksinim), Ö (öneri) ve A (açık karar) ayrımını korur. PDF'deki devir yönergeleri bağlam kaydıdır; uygulama kapsamını kullanıcının bu konuşmadaki ilk aşama isteği belirler.

## Kesinleşen hedef kapsam (K)

Şirketlerin gerçek işe alım süreci; pozisyon ve ağırlıklı yetkinlikler (JOB-01, JOB-03), CV analizi ve e-posta daveti (CV-01/02), adayın e-posta koduyla tekrar girişi (AUTH-01/02), hesaplı şirket girişi (AUTH-05), CV'ye ve cevaba göre değişen sesli AI mülakatı (INT-01/05), uygulamalı görev (TASK-01/02), eksiksiz kapsam denetimi, tam ses/video kaydı ve zamanlı transkript (REP-01/04), kanıtlı yüzdeli değerlendirme ve karşılaştırma, insan incelemeli itiraz ve geri bildirim (APP-01/05). AI kararı nihai ve itiraz edilemez işe alım kararı değildir. Görünüş, ses tonu veya duygu üzerinden kişilik/yetkinlik çıkarımı kapsamda yoktur.

## Bu aşamada uygulanan

Önceki SQLite/JavaScript uygulamasındaki ilk aşama akışları React/TypeScript/PostgreSQL yapısına taşındı. İkinci aşamada pozisyon detay/düzenleme ve plan sürümü, başvuruya özel aday adı, özel PDF CV saklama, manuel süreli davet ve aday paneli eklendi. Üçüncü aşamada değiştirilebilir SMTP taşıyıcısı, aday kodu e-postası ve açık şirket işlemiyle davet e-postası eklendi. `pg-migrations/003_email_delivery.sql` kalıcı gönderim işleri ve istek sınırlarını tutar. Yerel makinede `MAIL_MODE=test` etkindir; gerçek SMTP hesabı henüz yapılandırılmamış ve gerçek teslim doğrulanmamıştır. Kod yalnız açık test modunda ekranda görünür; SMTP modunda ekranda ve logda görünmez.

## Açık kararlar (A)

- Görüşme ortamı: kendi web uygulaması veya Zoom.
- Davetin otomatik ya da şirket onaylı gönderimi. Geçici ikinci aşama davranışı şirketin manuel davet hazırlamasıdır; e-posta teslimi yoktur.
- İlk pozisyon ailesi, rubrik ve eksik kanıtta genel puan politikası.
- CV/aday giriş kanalı, nihai dosya türleri ve boyutları. İkinci aşama yerel PDF sınırı 5 MB'dir.
- Kayıt bilgilendirmesi, erişim ve saklama süreleri.
- Adaya açılacak rapor alanları; ekip yetki ayrıntıları.
- AI, ses, e-posta, nesne depolama ve bulut sağlayıcıları; ürün adı ve bütçe.

Bunlar ilk çalışan iskeletin kurulmasını engellemez. Bu kararlarla ilgili özellikler etkin olarak sunulmaz.

## Önerilen ürün mimarisi

Seçilen temel: **React + TypeScript + Vite** istemcisi, **Express + TypeScript** API ve **PostgreSQL** veritabanı. Veri erişimi `pg` ile parametreli SQL ve tek istemcili işlemler üzerinden yapılır; sürümlü SQL migration'lar `pg-migrations/` altındadır. Bu makinede önceden kurulu PostgreSQL 18 kullanılır; `compose.yaml` Docker bulunan başka makineler için alternatiftir. SQLite yalnız eski veriyi okumak için aktarım komutunda geliştirme bağımlılığı olarak kalır. Henüz bağlanmayan sonraki modüller için sunucu yetkili nesne depolama, WebRTC taşıma, sağlayıcı adaptörleri ve arka plan iş kuyruğu önerilir. Model/ses/video/e-posta sağlayıcıları seçilmedi.

Alan sınırları: `identity` (şirket üyeliği, aday kodu, oturum), `positions` (gereksinim ve sürüm), `applications` (aday/başvuru), `invitations`, `documents`, `interviews` (oturum/konuşma/kapsam), `media` (kayıt/transkript), `assessments` (rubrik/kanıt/rapor), `appeals` (insan incelemesi), `audit` ve `jobs`. İlk aşama rotaları `server/index.ts`, ikinci aşama rotaları `server/stage2.ts` içindedir. Kayıt/AI adaptörleri henüz eklenmedi.

Temel ilişkiler: `organization 1—N membership N—1 user`; `organization 1—N position 1—N requirement`; `candidate 1—N application N—1 position`; `application 1—0/1 CV`, `application 1—N invitation`. Pozisyon planı `position_versions` ile sürümlenir; başvuru ve davet oluşturuldukları sürüme bağlıdır. Başvuru, CV ve davette `organization_id` saklanır. Uygulama sorguları şirket veya aday kimliğiyle sınırlandırılır; PostgreSQL şemasındaki birleşik yabancı anahtarlar çapraz şirket pozisyon bağını reddeder. Şema yerel PostgreSQL üzerinde uygulandı. Görüşme gibi sonraki şirket varlıkları da aynı şirket kimliğiyle kapsamlanmalıdır.

## Önerilen aşamalar

1. **Çalışan ilk aşama:** giriş, paneller, pozisyon, veri modeli, şirket/RBAC kontrolü.
2. **Başvuru ve davet:** Bu aşamada şirket aday/başvuru ve özel PDF CV ekler, manuel davet hazırlar; aday kod doğrulaması sonrası daveti görür. Gerçek e-posta ve otomatik teslim sonraki karara bağlıdır.
3. **Görüşme:** ortam seçimi, cihaz kontrolü, sesli AI, takip soruları, kapsam izleme, kesintiden devam ve tam kayıt.
4. **Değerlendirme:** görev, transkript, kanıtlı rubrik, rapor sürümü ve ağırlıklı karşılaştırma.
5. **İnsan incelemesi:** itiraz, gerekçeli düzeltme, geri bildirim ve denetim.
6. **Pilot ve ürünleşme:** alan uzmanı doğrulaması, yük/güvenlik/erişilebilirlik, maliyet, saklama ve operasyon hedefleri.

Her aşamanın kabulü ilgili PDF kabul senaryoları ile test edilir. İlk ve ikinci aşamanın çalışan kapsamı `integration/postgres.test.ts`, `integration/stage2.test.ts` ve `integration/browser.test.ts` ile doğrulandı.
