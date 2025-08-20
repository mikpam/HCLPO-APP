import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from "../shared/schema";

// Log database connection info for debugging
const dbUrl = process.env.DATABASE_URL;
console.log('🔍 Database connection check:', {
  hasDbUrl: !!dbUrl,
  isNeonDb: dbUrl?.includes('neon.tech') || false,
  nodeEnv: process.env.NODE_ENV,
  dbHost: dbUrl?.includes('@') ? dbUrl.split('@')[1]?.split('/')[0]?.substring(0, 20) + '...' : 'NOT_SET'
});

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set in environment variables!');
  console.error('Available env vars:', Object.keys(process.env).filter(k => !k.includes('SECRET') && !k.includes('KEY')).sort());
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

export const db = drizzle(pool, { schema });