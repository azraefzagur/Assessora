import 'dotenv/config';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL tanımlanmalı. PostgreSQL olmadan uygulama başlatılmaz.');
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000, max: 10 });
pool.on('error', error => {
  console.error('PostgreSQL boş bağlantısı kapandı:', error.message);
});
export type SqlClient = Pick<pg.PoolClient, 'query'>;
export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
