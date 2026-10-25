import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import { pool } from './db.ts';
import type { ActorType, Session } from './types.ts';

export const newId = (): string => randomUUID();
export const hashToken = (value:string):string => createHash('sha256').update(value).digest('hex');
export function hashPassword(password:string):string {
  const salt=randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;
}
export function verifyPassword(password:string,stored:string):boolean {
  const [salt,hex]=stored.split(':');
  if (!salt || !hex) return false;
  const actual=scryptSync(password,salt,64), expected=Buffer.from(hex,'hex');
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}
export function csrfValid(submitted:unknown,expected:string):boolean {
  if(typeof submitted!=='string' || !/^[a-f0-9]{48}$/.test(submitted)) return false;
  const a=Buffer.from(submitted,'hex'), b=Buffer.from(expected,'hex');
  return a.length===b.length && timingSafeEqual(a,b);
}
export async function createSession(type:ActorType=null,id:string|null=null,organizationId:string|null=null):Promise<{token:string; session:Session}> {
  const token=randomBytes(32).toString('hex'), csrf=randomBytes(24).toString('hex');
  const expires=new Date(Date.now()+8*60*60*1000);
  const session:Session={id_hash:hashToken(token),actor_type:type,actor_id:id,organization_id:organizationId,csrf_token:csrf,expires_at:expires};
  await pool.query('INSERT INTO sessions (id_hash,actor_type,actor_id,organization_id,csrf_token,expires_at,development_only) VALUES ($1,$2,$3,$4,$5,$6,$7)',[session.id_hash,type,id,organizationId,csrf,expires,process.env.NODE_ENV==='development']);
  return {token,session};
}
export async function findSession(token:string|undefined):Promise<Session|null> {
  if(!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const {rows}=await pool.query<Session>('SELECT * FROM sessions WHERE id_hash=$1 AND expires_at>now() AND ($2::boolean OR development_only=false)',[hashToken(token),process.env.NODE_ENV==='development']);
  return rows[0]||null;
}
export function setSessionCookie(res:Response,token:string):void {
  res.cookie('assessora_session',token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:8*60*60*1000});
}
