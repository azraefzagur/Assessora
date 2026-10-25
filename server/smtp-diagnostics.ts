type Diagnostic={code:string;responseCode:number|null;stage:string;summary:string};
const safeCodes=new Set(['EAUTH','ENOAUTH','ECONFIG','ECONNECTION','ESOCKET','ETLS','EDNS','ETIMEDOUT','EREQUIRETLS','EENVELOPE','EMESSAGE']);
const certificateCodes=new Set(['CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID']);

export function smtpDiagnostic(error:unknown):Diagnostic{
  const value=error&&typeof error==='object'?error as Record<string,unknown>:{};
  const rawCode=typeof value.code==='string'?value.code:'';
  const cause=value.cause&&typeof value.cause==='object'?value.cause as Record<string,unknown>:{};
  const causeCode=typeof cause.code==='string'?cause.code:'';
  const code=safeCodes.has(rawCode)||certificateCodes.has(rawCode)?rawCode:'UNKNOWN';
  const responseCode=typeof value.responseCode==='number'&&Number.isInteger(value.responseCode)&&value.responseCode>=100&&value.responseCode<=599?value.responseCode:null;
  const command=typeof value.command==='string'?value.command.toUpperCase():'';
  const syscall=typeof value.syscall==='string'?value.syscall:'';
  const certificateProblem=certificateCodes.has(rawCode)||certificateCodes.has(causeCode);
  if(certificateProblem)return {code,responseCode,stage:'TLS sertifika doğrulaması',summary:'Sunucunun TLS sertifikası doğrulanamadı. Sunucu adı, sertifika zinciri ve sistem saatini kontrol edin.'};
  if(rawCode==='EAUTH'||rawCode==='ENOAUTH'||command.startsWith('AUTH')||[534,535].includes(responseCode||0))return {code,responseCode,stage:'SMTP kimlik doğrulaması',summary:'SMTP hesabı kimlik doğrulamasını reddetti. Kullanıcı adı, uygulama parolası ve hesap izinlerini sağlayıcı tarafında kontrol edin.'};
  if(rawCode==='EDNS')return {code,responseCode,stage:'DNS çözümleme',summary:'SMTP sunucu adı çözümlenemedi. Sunucu adresini ve DNS bağlantısını kontrol edin.'};
  if(command==='CONN'||syscall==='connect'||rawCode==='ECONNECTION')return {code,responseCode,stage:'TCP bağlantısı',summary:'SMTP sunucusuna TCP bağlantısı kurulamadı. Sunucu, port ve ağ erişimini kontrol edin.'};
  if(rawCode==='ETLS'||rawCode==='EREQUIRETLS'||command.includes('STARTTLS'))return {code,responseCode,stage:'STARTTLS/TLS',summary:'Güvenli bağlantı kurulamadı. Sunucunun STARTTLS desteğini ve sertifikasını kontrol edin.'};
  if(rawCode==='ETIMEDOUT')return {code,responseCode,stage:'Bağlantı zaman aşımı',summary:'SMTP sunucusu zamanında yanıt vermedi. Ağ erişimini ve sunucu durumunu kontrol edin.'};
  if(command==='EHLO'||command==='HELO')return {code,responseCode,stage:'SMTP karşılama',summary:'SMTP sunucusu karşılama aşamasında isteği kabul etmedi.'};
  return {code,responseCode,stage:'SMTP doğrulaması',summary:'SMTP doğrulaması başarısız. Sunucu ayarlarını ve sağlayıcı durumunu kontrol edin.'};
}
