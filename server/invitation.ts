import 'dotenv/config';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {hashToken} from './security.ts';
import {uuidPattern} from './validation.ts';

const signingKey=process.env.INVITATION_SIGNING_KEY;
if(!signingKey||signingKey.length<32||signingKey.startsWith('replace-with-')) throw new Error('INVITATION_SIGNING_KEY rastgele ve en az 32 karakter olmalı.');
function signature(id:string):string{return createHmac('sha256',signingKey!).update(id).digest('hex');}
export function invitationToken(id:string):string{return `${id}.${signature(id)}`;}
export function invitationHash(id:string):string{return hashToken(invitationToken(id));}
export function idFromInvitationToken(token:string):string|null{
  const [id,provided,extra]=token.split('.');
  if(extra||!uuidPattern.test(id||'')||!provided||!/^[a-f0-9]{64}$/.test(provided))return null;
  const a=Buffer.from(provided,'hex'),b=Buffer.from(signature(id),'hex');
  return a.length===b.length&&timingSafeEqual(a,b)?id:null;
}
