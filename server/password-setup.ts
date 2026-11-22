import 'dotenv/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { hashToken } from './security.ts';
import { uuidPattern } from './validation.ts';

// Davet bağlantılarıyla aynı desen: token = "<id>.<HMAC(id)>". Veritabanında yalnız hash'i tutulur;
// e-posta işi bağlantıyı id'den yeniden üretebilir, veritabanını okuyan biri üretemez.
const signingKey = process.env.INVITATION_SIGNING_KEY;
if (!signingKey || signingKey.length < 32 || signingKey.startsWith('replace-with-')) throw new Error('INVITATION_SIGNING_KEY rastgele ve en az 32 karakter olmalı.');

export const SETUP_TOKEN_HOURS = 48;
const signature = (id: string): string => createHmac('sha256', signingKey!).update(`password-setup:${id}`).digest('hex');

export function setupToken(id: string): string { return `${id}.${signature(id)}`; }
export function setupHash(id: string): string { return hashToken(setupToken(id)); }
export function setupPath(id: string): string { return `/sirket/sifre-belirle/${setupToken(id)}`; }

export function idFromSetupToken(token: string): string | null {
  const [id, provided, extra] = String(token || '').split('.');
  if (extra || !uuidPattern.test(id || '') || !provided || !/^[a-f0-9]{64}$/.test(provided)) return null;
  const a = Buffer.from(provided, 'hex'), b = Buffer.from(signature(id), 'hex');
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}
