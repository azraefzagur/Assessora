import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pool } from './db.ts';

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of readdirSync(resolve('pg-migrations')).filter(x => x.endsWith('.sql')).sort()) {
      if ((await client.query('SELECT 1 FROM schema_migrations WHERE name=$1',[name])).rowCount) continue;
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(resolve('pg-migrations',name),'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)',[name]);
        await client.query('COMMIT');
        console.log(`Migration uygulandı: ${name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
  }
}
if (process.argv[1]?.endsWith('migrate.ts')) migrate().then(() => pool.end(),async e => { console.error(e); await pool.end(); process.exitCode=1; });
