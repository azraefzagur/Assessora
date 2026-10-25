import 'dotenv/config';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { pool, transaction } from './db.ts';

const source=process.argv[2];
if(process.env.NODE_ENV!=='development') throw new Error('SQLite geliştirme verisi yalnız geliştirme ortamına aktarılabilir.');
if(!source||!existsSync(source)) throw new Error('Kullanım: npm run import:sqlite -- data/backups/assessora-before-postgres-2026-10-25.db');
const sqlite=new Database(source,{readonly:true,fileMustExist:true});
const tables=['organizations','users','memberships','candidates','positions','position_requirements','applications'] as const;
const columns:Record<(typeof tables)[number],string[]>={
  organizations:['id','name','created_at'],
  users:['id','email','password_hash','created_at','development_only'],
  memberships:['id','organization_id','user_id','role','active'],
  candidates:['id','email','full_name','created_at'],
  positions:['id','organization_id','title','description','status','created_by_user_id','created_at'],
  position_requirements:['id','organization_id','position_id','label','required','weight','sort_order'],
  applications:['id','organization_id','position_id','candidate_id','status','created_at']
};
try{
  const counts=await transaction(async client=>{
    for(const table of tables){
      const result=await client.query(`SELECT count(*)::int AS count FROM ${table}`);
      if(result.rows[0].count!==0) throw new Error('PostgreSQL hedefinde veri var. İçe aktarma yalnız boş şemaya yapılır.');
    }
    const result:Record<string,number>={};
    for(const table of tables){
      const sourceColumns=columns[table].filter(column=>column!=='development_only');
      const rows=sqlite.prepare(`SELECT ${sourceColumns.join(',')} FROM ${table}`).all() as Record<string,unknown>[];
      for(const row of rows){
        const values=columns[table].map(column=>{
          const value=row[column];
          if(column==='development_only') return true;
          if(column==='active'||column==='required') return Boolean(value);
          if(column==='created_at'&&typeof value==='string') return new Date(value.replace(' ','T')+'Z');
          return value;
        });
        const placeholders=values.map((_,i)=>`$${i+1}`).join(',');
        await client.query(`INSERT INTO ${table} (${columns[table].join(',')}) VALUES (${placeholders})`,values);
      }
      const current=(await client.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count as number;
      if(current!==rows.length) throw new Error(`${table} satır sayısı uyuşmadı.`);
      result[table]=current;
    }
    return result;
  });
  console.log('Kalıcı veriler aktarıldı ve sayılar doğrulandı:',counts);
  console.log('Oturumlar ve kısa ömürlü giriş kodları taşınmadı; kullanıcılar yeniden giriş yapmalı.');
}catch(error){console.error(error);process.exitCode=1;}finally{sqlite.close();await pool.end();}
