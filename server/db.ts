import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from "../shared/schema";

// ENFORCED: Single Neon PostgreSQL database only
// REQUIRED ENDPOINT: ep-mute-bush-afa56yb4-pooler.c-2.us-west-2.aws.neon.tech
let dbUrl = process.env.DATABASE_URL;
const REQUIRED_ENDPOINT = 'ep-mute-bush-afa56yb4-pooler.c-2.us-west-2.aws.neon.tech';

// Clean the DATABASE_URL if it has "psql" command prefix
if (dbUrl) {
  // Remove "psql" command prefix and quotes if present
  if (dbUrl.startsWith('psql')) {
    // Extract the actual URL from psql command format
    const match = dbUrl.match(/['"]?(postgresql:\/\/[^'"]+)['"]?/);
    if (match) {
      dbUrl = match[1];
      console.log('✅ Cleaned DATABASE_URL from psql command format');
    }
  }
}

// Validate this is the correct Neon database endpoint
if (!dbUrl?.includes(REQUIRED_ENDPOINT)) {
  console.error('❌ ERROR: Only the specific Neon endpoint is allowed!');
  console.error(`Required endpoint: ${REQUIRED_ENDPOINT}`);
  console.error('Current DATABASE_URL does not match the required endpoint');
  throw new Error(`System requires Neon PostgreSQL at ${REQUIRED_ENDPOINT}`);
}

console.log('✅ Neon Database connection verified:', {
  isNeonDb: true,
  endpoint: REQUIRED_ENDPOINT,
  nodeEnv: process.env.NODE_ENV
});

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set to a Neon PostgreSQL connection string",
  );
}

// Configure pool with Neon-specific SSL settings
// Use the cleaned dbUrl instead of raw process.env.DATABASE_URL
export const pool = new Pool({ 
  connectionString: dbUrl, // Use cleaned URL
  ssl: true, // Simplified SSL configuration for Neon
  max: 10, // Connection pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

// Single database instance - Neon PostgreSQL only
export const db = drizzle(pool, { schema });