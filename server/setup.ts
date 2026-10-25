import 'dotenv/config';
import { pool, transaction } from './db.ts';
import { hashPassword, newId } from './security.ts';

const [mode,...args]=process.argv.slice(2);
if(process.env.NODE_ENV!=='development') throw new Error('Test verisi oluşturma yalnız geliştirme ortamında kullanılabilir.');
try{
  if(mode==='company'){
    const [name,emailRaw]=args;
    const email=String(emailRaw||'').trim().toLowerCase(),password=process.env.SETUP_PASSWORD||'';
    if(!name||name.length<2||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<12) throw new Error('Kullanım: SETUP_PASSWORD ortam değişkenini ayarlayın; npm run setup -- company "Şirket Adı" admin@ornek.test');
    const orgId=newId(),userId=newId();
    await transaction(async client=>{
      await client.query('INSERT INTO organizations (id,name) VALUES ($1,$2)',[orgId,name]);
      await client.query('INSERT INTO users (id,email,password_hash,development_only) VALUES ($1,$2,$3,true)',[userId,email,hashPassword(password)]);
      await client.query('INSERT INTO memberships (id,organization_id,user_id,role) VALUES ($1,$2,$3,$4)',[newId(),orgId,userId,'admin']);
    });
    console.log(`Geliştirme şirketi ve yönetici oluşturuldu. Şirket kimliği: ${orgId}`);
  }else if(mode==='candidate'){
    const [orgId,positionId,fullName,emailRaw]=args;
    const email=String(emailRaw||'').trim().toLowerCase();
    if(!orgId||!positionId||!fullName||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Kullanım: npm run setup -- candidate ŞİRKET_KİMLİĞİ POZİSYON_KİMLİĞİ "Ad Soyad" aday@ornek.test');
    const position=await pool.query('SELECT id,current_version FROM positions WHERE id=$1 AND organization_id=$2',[positionId,orgId]);
    if(!position.rows[0]) throw new Error('Bu şirkete ait pozisyon bulunamadı.');
    await transaction(async client=>{
      let candidate=(await client.query<{id:string}>('SELECT id FROM candidates WHERE lower(email)=$1',[email])).rows[0];
      if(!candidate){candidate={id:newId()};await client.query('INSERT INTO candidates (id,email,full_name) VALUES ($1,$2,$3)',[candidate.id,email,fullName]);}
      await client.query('INSERT INTO applications (id,organization_id,position_id,candidate_id,candidate_name,position_version) VALUES ($1,$2,$3,$4,$5,$6)',[newId(),orgId,positionId,candidate.id,fullName,position.rows[0].current_version]);
    });
    console.log('Yalnız geliştirme için test başvurusu oluşturuldu. E-posta gönderilmedi.');
  }else throw new Error('Kullanım: npm run setup -- company ... veya npm run setup -- candidate ...');
}catch(error){console.error(error);process.exitCode=1;}finally{await pool.end();}
