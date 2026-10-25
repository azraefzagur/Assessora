import 'dotenv/config';
import { db } from './db.js';
import { newId, hashPassword } from './security.js';
import './migrate.js';

const [mode, ...args] = process.argv.slice(2);
if (process.env.NODE_ENV !== 'development') throw new Error('Kurulum komutu yalnız geliştirme ortamında kullanılabilir.');
if (mode === 'company') {
  const [name, emailRaw, password] = args;
  const email = String(emailRaw || '').trim().toLowerCase();
  if (!name || name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 12) throw new Error('Kullanım: npm run setup -- company "Şirket Adı" admin@ornek.com "en-az-12-karakter-sifre"');
  const orgId = newId(), userId = newId();
  db.transaction(() => {
    db.prepare('INSERT INTO organizations (id,name) VALUES (?,?)').run(orgId,name);
    db.prepare('INSERT INTO users (id,email,password_hash) VALUES (?,?,?)').run(userId,email,hashPassword(password));
    db.prepare('INSERT INTO memberships (id,organization_id,user_id,role) VALUES (?,?,?,?)').run(newId(),orgId,userId,'admin');
  })();
  console.log(`Şirket ve yönetici oluşturuldu. Şirket kimliği: ${orgId}`);
} else if (mode === 'candidate') {
  const [orgId, positionId, fullName, emailRaw] = args;
  const email = String(emailRaw || '').trim().toLowerCase();
  if (!orgId || !positionId || !fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Kullanım: npm run setup -- candidate ŞİRKET_KİMLİĞİ POZİSYON_KİMLİĞİ "Ad Soyad" aday@ornek.com');
  const position = db.prepare('SELECT id FROM positions WHERE id=? AND organization_id=?').get(positionId,orgId);
  if (!position) throw new Error('Bu şirkete ait pozisyon bulunamadı.');
  let candidate = db.prepare('SELECT id FROM candidates WHERE email=?').get(email);
  db.transaction(() => {
    if (!candidate) {
      candidate = { id: newId() };
      db.prepare('INSERT INTO candidates (id,email,full_name) VALUES (?,?,?)').run(candidate.id,email,fullName);
    }
    db.prepare('INSERT INTO applications (id,organization_id,position_id,candidate_id) VALUES (?,?,?,?)').run(newId(),orgId,positionId,candidate.id);
  })();
  console.log('Yalnız geliştirme için test başvurusu oluşturuldu. Gerçek davet gönderilmedi.');
} else {
  console.log('Kullanım: npm run setup -- company ... veya npm run setup -- candidate ...');
  process.exitCode = 1;
}
