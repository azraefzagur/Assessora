import {test} from 'node:test';
import assert from 'node:assert/strict';
import {smtpDiagnostic} from './smtp-diagnostics.ts';

test('SMTP kimlik doğrulama hatası güvenli ve somut özetlenir',()=>{
  const result=smtpDiagnostic({code:'EAUTH',responseCode:535,command:'AUTH LOGIN',message:'password=secret user=private@example.com'});
  assert.equal(result.code,'EAUTH');assert.equal(result.responseCode,535);assert.equal(result.stage,'SMTP kimlik doğrulaması');
  assert.ok(!JSON.stringify(result).includes('secret'));assert.ok(!JSON.stringify(result).includes('private@example.com'));
});
test('Bağlantı ve TLS aşamaları ayrılır',()=>{
  assert.equal(smtpDiagnostic({code:'ESOCKET',syscall:'connect',command:'CONN'}).stage,'TCP bağlantısı');
  assert.equal(smtpDiagnostic({code:'ETLS',command:'STARTTLS'}).stage,'STARTTLS/TLS');
  assert.equal(smtpDiagnostic({code:'ESOCKET',cause:{code:'CERT_HAS_EXPIRED'}}).stage,'TLS sertifika doğrulaması');
});
