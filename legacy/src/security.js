import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { db } from './db.js';

export const newId = () => randomUUID();
export const hashToken = value => createHash('sha256').update(value).digest('hex');
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, original] = stored.split(':');
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(original, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function newSession(actorType = null, actorId = null, organizationId = null) {
  const token = randomBytes(32).toString('hex');
  const csrf = randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (id_hash,actor_type,actor_id,organization_id,csrf_token,expires_at) VALUES (?,?,?,?,?,?)')
    .run(hashToken(token), actorType, actorId, organizationId, csrf, Date.now() + 8 * 60 * 60 * 1000);
  return { token, csrf };
}
export function sessionFromToken(token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare('SELECT * FROM sessions WHERE id_hash = ? AND expires_at > ?').get(hashToken(token), Date.now()) || null;
}
export function cookie(token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `assessora_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${secure}`;
}
export function csrfValid(submitted, expected) {
  if (typeof submitted !== 'string' || !expected) return false;
  const a = Buffer.from(submitted);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
