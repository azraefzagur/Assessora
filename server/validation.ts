import type { PositionInput } from './types.ts';
export class ValidationError extends Error {}
export class HttpError extends Error { constructor(public status:number,message:string){super(message);} }
export const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parsePosition(value:unknown):PositionInput {
  if(!value || typeof value!=='object') throw new ValidationError('Pozisyon bilgileri gerekli.');
  const raw=value as Record<string,unknown>;
  const title=typeof raw.title==='string'?raw.title.trim():'';
  const description=typeof raw.description==='string'?raw.description.trim():'';
  if(title.length<3||title.length>160||description.length<10||description.length>10000) throw new ValidationError('Başlık veya iş tanımı geçersiz.');
  if(!Array.isArray(raw.requirements)||raw.requirements.length<1||raw.requirements.length>20) throw new ValidationError('1–20 yetkinlik girin.');
  const requirements=raw.requirements.map((item:unknown)=>{
    const row=item as Record<string,unknown>;
    const label=typeof row?.label==='string'?row.label.trim():'';
    const weight=row?.weight;
    if(!label||label.length>120||typeof weight!=='number'||!Number.isInteger(weight)||weight<0||weight>100||typeof row.required!=='boolean') throw new ValidationError('Yetkinlik veya ağırlık geçersiz.');
    return {label,weight,required:row.required};
  });
  if(requirements.reduce((sum,r)=>sum+r.weight,0)!==100) throw new ValidationError('Yetkinlik ağırlıkları toplamı %100 olmalı.');
  return {title,description,requirements};
}

export function parseApplication(value:unknown):{positionId:string;fullName:string;email:string}{
  const raw=value as Record<string,unknown>|null;
  const positionId=typeof raw?.positionId==='string'?raw.positionId:'';
  const fullName=typeof raw?.fullName==='string'?raw.fullName.trim():'';
  const email=typeof raw?.email==='string'?raw.email.trim().toLowerCase():'';
  if(!uuidPattern.test(positionId)||fullName.length<2||fullName.length>160||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('Pozisyon, ad soyad veya e-posta geçersiz.');
  return {positionId,fullName,email};
}

export function parseInvitation(value:unknown):{estimatedMinutes:number;expiresAt:Date}{
  const raw=value as Record<string,unknown>|null;
  const estimatedMinutes=raw?.estimatedMinutes;
  const expiresAt=typeof raw?.expiresAt==='string'?new Date(raw.expiresAt):new Date(NaN);
  const delta=expiresAt.getTime()-Date.now();
  if(typeof estimatedMinutes!=='number'||!Number.isInteger(estimatedMinutes)||estimatedMinutes<15||estimatedMinutes>120||!Number.isFinite(delta)||delta<10*60*1000||delta>30*24*60*60*1000) throw new ValidationError('Süre 15–120 dakika, son katılım tarihi 10 dakika–30 gün sonrası olmalı.');
  return {estimatedMinutes,expiresAt};
}
