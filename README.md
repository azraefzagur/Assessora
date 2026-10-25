# Mülakat — yerel geliştirme

React + TypeScript arayüzü, Express + TypeScript API'si ve PostgreSQL veritabanı. Pozisyon, aday/CV ve manuel davet akışları çalışır. SMTP ile giriş kodu ve davet gönderimi uygulanmıştır; bu makinede SMTP hesabı henüz yapılandırılmadığından gerçek gönderim doğrulanmamıştır. Yerel `.env` açıkça `MAIL_MODE=test` kullanır: gerçek e-posta göndermez, kod yalnız doğrulama ekranında görünür. AI, sesli görüşme, Zoom, avatar, video kaydı ve değerlendirme puanı yoktur. Üretim için kalan güvenlik ve operasyon çalışmaları vardır.

## Bu makinedeki durum

- Windows 11 Pro; PostgreSQL 18.3 kurulu. Docker kurulu değil, WSL Ubuntu duruyor. Docker kurulumu gerekmedi.
- Kullanıcıya ait yerel PostgreSQL kümesi `data/postgres18` altında oluşturuldu. Yalnız `127.0.0.1:5432` üzerinde dinler; Windows servisi olarak kayıtlı değildir. Yeniden başlatmadan sonra aşağıdaki `pg_ctl start` komutu gerekir.
- `.env` içinde yerel bağlantı ayarları var ve git dışında tutuluyor. Parola README'ye yazılmadı.
- `assessora` veritabanına migration ve **yalnız bir kez** SQLite aktarımı uygulandı. Kaynak `data/assessora.db` ve tutarlı yedek `data/backups/assessora-before-postgres-2026-10-25.db` korunuyor.
- İlk SQLite aktarımındaki kalıcı kayıtlar: şirket 1, kullanıcı 1, üyelik 1. Sonradan oluşturulan aday/pozisyon/başvurular korunur; sayıları değişebilir. Eski oturumlar ve kısa ömürlü kodlar taşınmadı.
- İkinci aşama öncesi PostgreSQL yedeği `data/backups/assessora-before-stage2-2026-10-25.dump` dosyasında korunur. `002_application_invitation.sql` eklemeli migration olarak uygulandı; aktarılan hesap ve kayıtlar sıfırlanmadı.
- Aktarılan geliştirme şirket hesabıyla gerçek API girişi ve paneli doğrulandı; şifresi değiştirilmedi. PostgreSQL `pg_ctl restart` sonrası API bağlantısının geri geldiği kontrol edildi.
- E-posta aşaması öncesi yedek `data/backups/assessora-before-email-2026-10-25.dump` alındı. `003_email_delivery.sql` eklemeli migration uygulandı. Bu kontrol sırasında gerçek veritabanında şirket 1, kullanıcı 1, üyelik 1, aday 1, pozisyon 1, başvuru 1, davet 0 ve migration 3 vardı; mevcut kayıtlar sıfırlanmadı.

## Bu makinede başlatma (PowerShell)

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D 'C:\Users\Azra\Assessora\data\postgres18' status
# Sunucu durmuşsa:
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D 'C:\Users\Azra\Assessora\data\postgres18' -l 'C:\Users\Azra\Assessora\data\postgres18.log' -o '-h 127.0.0.1 -p 5432' start
& 'C:\Program Files\PostgreSQL\18\bin\pg_isready.exe' -h 127.0.0.1 -p 5432
npm run dev
```

Tarayıcıda `http://127.0.0.1:5173` adresini açın. Vite 5173, API 3001 kullanır. Aktarılan geliştirme şirket hesabının kimlik bilgileri değişmedi; yeni varsayılan hesap oluşturulmadı. Otomatik tarayıcı testi ayrı geçici veritabanında yapılır.

## E-posta modu ve SMTP kurulumu

Üç mod vardır: `MAIL_MODE=disabled` tüm gönderimi kapatır; `MAIL_MODE=test` yalnız `NODE_ENV=development` ile çalışır, gerçek e-posta göndermez ve aday kodunu yerel doğrulama ekranında gösterir; `MAIL_MODE=smtp` gerçek SMTP aktarımını kullanır. Test modu üretimde açılamaz. Gerçek modda kod API yanıtında, ekranda veya loglarda bulunmaz. Her iki gönderim türünde de iş durumu PostgreSQL `email_jobs` tablosuna kaydedilir.

Gerçek gönderimi kurmak için kendi seçtiğiniz SMTP sağlayıcısında hesap açın, sağlayıcının istediği uygulama parolasını veya SMTP kimlik bilgilerini oluşturun ve gönderen adresini/alan adını doğrulayın. Sağlayıcının gerektirdiği DNS kayıtlarını (ör. SPF/DKIM) yapılandırın. Parolayı sohbete veya git'e yazmayın. Yalnız git tarafından dışlanan yerel `.env` dosyasında şu değerleri ayarlayın:

```dotenv
MAIL_MODE=smtp
SMTP_HOST=smtp.saglayici.example
SMTP_PORT=587
SMTP_USER=hesap
SMTP_PASSWORD=uygulama-parolasi
MAIL_FROM=dogrulanmis-gonderici@example.com
APP_PUBLIC_URL=https://yayindaki-uygulama.example
CODE_SIGNING_KEY=en-az-32-karakterlik-kalici-rastgele-gizli-anahtar
```

Port `465` doğrudan TLS, diğer portlar zorunlu STARTTLS kullanır. `CODE_SIGNING_KEY` değiştirilirse bekleyen kodlar doğrulanamaz; gizli ve kalıcı tutun. `INVITATION_SIGNING_KEY` de davet bağlantılarının sürekliliği için kalıcı olmalıdır. `APP_PUBLIC_URL` davet e-postasındaki bağlantının taban adresidir. SMTP modunda davet göndermek için dışarıdan erişilebilir **HTTPS** adresi gerekir; `localhost` başka cihazlarda çalışmaz. Şu anki yerel uygulama yalnız `127.0.0.1` üzerinde dinler. Gerçek dış erişim için HTTPS ters vekil, alan adı ve dağıtım ayrıca kurulmalıdır; bu kurulum yapılmadı.

`.env` değişiminden sonra uygulamayı yeniden başlatın. `npm run mail:check` SMTP bağlantısı ve kimlik doğrulamasını sınar; **e-posta göndermez** ve gönderen yetkisini veya gelen kutusuna teslimi doğrulamaz. Ardından sizin seçeceğiniz bir test adresini şirket panelinden aday olarak ekleyin, kod isteyin ve gelen kutusunda kodu görüp giriş yapın. Aynı adrese yalnız sizin başlattığınız bir daveti göndererek önizleme, sağlayıcı kabulü ve gelen kutusunu ayrı ayrı kontrol edin. Mevcut adaylara toplu gönderim yapmayın.

Kod 10 dakika geçerli ve tek kullanımlıktır. Doğrulama ekranındaki **Kodu yeniden iste** işlemi önceki kodları geçersiz kılar. Aynı e-posta için 10 dakikada en fazla üç, aynı IP için saatte en fazla yirmi istek; kod başına en fazla beş yanlış deneme vardır. Kayıtlı ve kayıtsız adresler gerçek modda aynı genel yanıtı alır. Test modunda görünen kod yalnız yerel geliştirme kolaylığıdır.

Davet **Hazırlandı** durumunda başlar. Yetkili şirket çalışanı önizlemede alıcı, şirket, pozisyon, son katılım ve bağlantıyı gördükten sonra **E-posta ile gönder** düğmesine basar. Gönderim durumları: bekliyor, gönderiliyor, sağlayıcı kabul etti, başarısız ve belirsiz. **Sağlayıcı kabulü gelen kutusuna teslim kanıtı değildir.** Başarısız iş elle tekrar başlatılabilir; sonucu belirsiz iş kontrolsüz otomatik tekrarlanmaz. Aynı davet için tek kalıcı iş kullanılır. İptal edilmiş veya süresi dolmuş davet gönderilemez. İptal işlemi daha önce kabul edilmiş e-postayı geri alamaz, fakat bağlantıyı geçersiz kılar.

## Tarayıcıda ikinci aşamayı deneme

1. `/sirket/giris` ekranında mevcut geliştirme şirket hesabınızla giriş yapın. Şifreyi bilmiyorsanız hesabı sıfırlamayın; ayrı test veritabanında `npm run test:browser` akışı doğrular.
2. **Yeni pozisyon** oluşturun. Yetkinlik ağırlıklarını toplam `%100` yapın; **Zorunlu** işaretiyle zorunlu ve tercih edilenleri ayırın.
3. Pozisyon detayında **Düzenle** ile durumu **Aktif** yapın. İçerik veya yetkinlik değişikliği değerlendirme planının yeni sürümünü oluşturur.
4. **Aday ekle** ile ad, e-posta ve pozisyon seçip başvuru oluşturun. Aynı e-posta aynı pozisyona yeniden eklenirse açık hata gösterilir. Başka şirketteki adayın başvuruya özel adı görünmez.
5. Başvuru detayından en fazla 5 MB PDF CV yükleyin. **Yüklendi · İnceleme bekliyor** durumunu ve yetkili PDF açma bağlantısını kontrol edin. CV herkese açık dizinde değildir; yüklenen dosya bu sürümde değiştirilemez.
6. **Davet hazırla** ile tahmini süre ve son katılım tarihini girin. Önizlemede alıcıyı, şirketi, pozisyonu, saat dilimli son katılım tarihini ve bağlantıyı kontrol edin. Yerel test modundaysanız **E-posta ile gönder** düğmesi yalnız sahte taşıyıcıyı çalıştırır; gerçek e-posta gitmez. Gerçek SMTP modu ve dış HTTPS adresi kurulmadan gerçek davet göndermeyin.
7. Yerel test bağlantısını özel tarayıcı penceresinde açın. Şirket panelinde başvuruya eklediğiniz adayın e-posta adresini girip **Kod iste** deyin. Test modunda kod sonraki ekranda görünür; gerçek SMTP modunda kodu gelen kutusunda arayın. Kodu girip **Doğrula** deyin. Daveti, başvuru detayını ve **Başvurularım** panelindeki açık daveti görün. Yalnız bağlantı, giriş olmadan daveti açmaz.
8. Şirket ekranından daveti iptal ettiğinizde aday bağlantısı kapanır. Pozisyon kapatılırsa açık davetler de iptal edilir. Bu ekranda mülakat başlatılmaz.

Gerçek veritabanında deneme yaparsanız oluşan aday ve CV kayıtları kalıcıdır. Otomatik tarayıcı ve entegrasyon testleri ayrı geçici PostgreSQL veritabanları kullanır.

Bu makinede SMTP hesabı henüz yapılandırılmadığından hiçbir adrese gerçek kod veya davet gönderilmez. Test modunda kodu görmeden sayfayı yenilerseniz giriş ekranına dönüp yeniden kod isteyin; istek sınırına dikkat edin.

## Kontroller

```powershell
npm run migrate
npm test
npm run test:integration
npm run test:browser
npm run build
```

`migrate` tekrar çalıştırılabilir. `test:integration` ve `test:browser` geçici, ayrı PostgreSQL veritabanları oluşturup test sonunda kaldırır; **aktarılan `assessora` veritabanını değiştirmez**. Testlerde `MAIL_MODE=test` sahte taşıyıcısı kullanılır; gerçek kişilere e-posta gönderilmez. Tarayıcı testi Microsoft Edge'i başsız modda kullanır; 3001 ve 5173 portlarının boş olması gerekir. Bu yüzden `npm run dev` çalışıyorsa önce durdurun, testten sonra yeniden başlatın. Testler şirket/aday izolasyonu, rol, kod süresi/tek kullanım/yeniden istek/yanlış deneme sınırı, ağırlık, özel PDF erişimi, davet iptali/süresi, gönderim işi başarısızlığı/tekrar denemesi/belirsiz sonuç ve React ekran akışını kapsar.

## Aktarımı başka bir boş veritabanında yineleme

Mevcut `assessora` veritabanına aşağıdaki aktarımı **tekrar uygulamayın**. Yalnız yeni ve boş bir hedef veritabanında, o veritabanına işaret eden `.env` ile:

```powershell
npm run migrate
npm run import:sqlite -- data/backups/assessora-before-postgres-2026-10-25.db
```

İçe aktarma, hedefte herhangi bir kalıcı kayıt varsa işlem yapmadan durur. Veri tek veritabanı işleminde aktarılır ve tablo sayıları karşılaştırılır. Kaynak SQLite dosyası silinmez. Seed komutları aktarım sırasında çalıştırılmaz.

## Başka bir makinede Docker seçeneği

Docker Desktop varsa [compose.yaml](compose.yaml) kullanılabilir: `.env.example` dosyasını `.env` olarak kopyalayın, `POSTGRES_PASSWORD` ile `DATABASE_URL` içindeki parolayı aynı güçlü değerle değiştirin, `docker compose up -d postgres` çalıştırın. Ardından boş veritabanına migration ve gerekirse bir kez aktarım uygulayın. Docker bu makinede kurulu değildir.

Kaynak gereksinim eşlemesi [docs/requirements-stage1.md](docs/requirements-stage1.md), mimari ve açık kararlar [docs/architecture.md](docs/architecture.md) içindedir.
