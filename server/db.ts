import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from "../shared/schema";

// ENFORCED: Single Neon PostgreSQL database only
// No other databases are allowed in this system
const dbUrl = process.env.DATABASE_URL;

// Validate this is the Neon database
if (!dbUrl?.includes('neon.tech')) {
  console.error('❌ ERROR: Only Neon PostgreSQL database is allowed!');
  console.error('Current DATABASE_URL does not point to neon.tech');
  throw new Error('System requires Neon PostgreSQL database. Please set DATABASE_URL to a valid Neon connection string.');
}

console.log('✅ Neon Database connection verified:', {
  isNeonDb: true,
  nodeEnv: process.env.NODE_ENV,
  dbHost: dbUrl.split('@')[1]?.split('/')[0]?.substring(0, 20) + '...'
});

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set to a Neon PostgreSQL connection string",
  );
}

// Configure pool with Neon-specific SSL settings
export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Required for Neon
    require: true // SSL is mandatory for Neon
  },
  max: 10, // Connection pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

// Single database instance - Neon PostgreSQL only
export const db = drizzle(pool, { schema });