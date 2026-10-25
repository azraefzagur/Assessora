import 'dotenv/config';
import {mailMode,verifySmtpConnection} from './email.ts';
if(mailMode!=='smtp'){
  console.error('Gerçek SMTP kontrolü için .env içinde MAIL_MODE=smtp ve SMTP ayarları gerekli. Yerel test modu e-posta göndermez.');
  process.exitCode=1;
}else{
try{
  await verifySmtpConnection();
  console.log('SMTP bağlantısı ve kimlik doğrulaması geçti. Gönderici yetkisi ve gelen kutusuna teslim ayrıca test edilmelidir.');
}catch{
  console.error('SMTP bağlantısı veya kimlik doğrulaması başarısız. .env ayarlarını ve sağlayıcı hesabını kontrol edin.');
  process.exitCode=1;
}
}
