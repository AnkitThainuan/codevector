

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('neon') || process.env.DATABASE_URL?.includes('supabase')
    ? { rejectUnauthorized: false }
    : false,
});

async function createSchema() {
  const client = await pool.connect();
  try {
    console.log('Creating schema...');

    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE IF NOT EXISTS products (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        name        TEXT        NOT NULL,
        category    TEXT        NOT NULL,
        price       NUMERIC(10, 2) NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

 
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_products_cursor
        ON products (created_at DESC, id DESC);
    `);

    // Separate index for category filter + cursor (used when ?category= is set)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_products_category_cursor
        ON products (category, created_at DESC, id DESC);
    `);

    console.log('Schema created successfully.');
  } finally {
    client.release();
    await pool.end();
  }
}

createSchema().catch(err => {
  console.error('Schema creation failed:', err);
  process.exit(1);
});
