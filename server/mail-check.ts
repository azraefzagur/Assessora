import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import dotenv from 'dotenv';
import {smtpDiagnostic} from './smtp-diagnostics.ts';

function configurationFailure(summary:string):void{
  console.error('Hata kodu: CONFIG');
  console.error('SMTP responseCode: yok');
  console.error('Aşama: yapılandırma');
  console.error(`Güvenli özet: ${summary}`);
  process.exitCode=1;
}

async function main():Promise<void>{
  const envPath=resolve('.env');
  if(!existsSync(envPath))return configurationFailure('Yerel .env dosyası bulunamadı; .env.example kullanılmadı.');
  const fileValues=dotenv.parse(readFileSync(envPath));
  const loaded=dotenv.config({path:envPath,override:false,quiet:true});
  if(loaded.error)return configurationFailure('.env dosyası okunamadı.');
  const keys=['NODE_ENV','MAIL_MODE','SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASSWORD','MAIL_FROM','CODE_SIGNING_KEY','INVITATION_SIGNING_KEY'];
  const overridden=keys.filter(key=>fileValues[key]!==undefined&&process.env[key]!==fileValues[key]);
  const missing=keys.filter(key=>!fileValues[key]);
  console.log('Yapılandırma kaynağı: yerel .env dosyası (.env.example yüklenmedi).');
  if(overridden.length)return configurationFailure(`İşlem ortamı .env değerlerini geçersiz kılıyor: ${overridden.join(', ')}. Değerler gösterilmedi.`);
  console.log(`.env eşleşmesi: ${keys.length-missing.length}/${keys.length} alan; gizli değerler gösterilmedi.`);
  if(missing.length)return configurationFailure(`.env içinde eksik alanlar: ${missing.join(', ')}.`);
  try{
    const {mailMode,smtpSecuritySettings,verifySmtpConnection}=await import('./email.ts');
    if(mailMode!=='smtp')return configurationFailure('MAIL_MODE=smtp gerekli. Geçerli mod SMTP bağlantısı kurmuyor.');
    const security=smtpSecuritySettings();
    console.log(`Taşıma güvenliği: port ${security.port}; ${security.secure?'doğrudan TLS':'STARTTLS zorunlu'}; sertifika doğrulaması açık.`);
    try{
      await verifySmtpConnection();
      console.log('SMTP bağlantısı, TLS ve kimlik doğrulaması geçti. E-posta gönderilmedi; gönderen yetkisi ve gelen kutusuna teslim doğrulanmadı.');
    }catch(error){
      const diagnostic=smtpDiagnostic(error);
      console.error(`Hata kodu: ${diagnostic.code}`);
      console.error(`SMTP responseCode: ${diagnostic.responseCode??'yok'}`);
      console.error(`Aşama: ${diagnostic.stage}`);
      console.error(`Güvenli özet: ${diagnostic.summary}`);
      process.exitCode=1;
    }
  }catch{
    configurationFailure('Uygulamanın e-posta ayarları geçersiz. Gizli anahtar ve SMTP alanlarını kontrol edin.');
  }
}
await main();
