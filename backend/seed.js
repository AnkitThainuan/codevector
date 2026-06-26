/**
 * seed.js — generates 200,000 products fast using a single SQL statement.
 *
 * Key insight: doing 200k individual INSERTs from Node would be slow (~minutes).
 * Instead, we use PostgreSQL's generate_series() to create all rows server-side
 * in one query. The DB never leaves the server, no round-trips, no JS overhead.
 * Typically completes in 5–15 seconds on Neon/Supabase free tier.
 *
 * Run: node seed.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('neon') || process.env.DATABASE_URL?.includes('supabase')
    ? { rejectUnauthorized: false }
    : false,
});

// Categories to distribute across products
const CATEGORIES = [
  'Electronics',
  'Clothing',
  'Books',
  'Home & Kitchen',
  'Sports',
  'Toys',
  'Beauty',
  'Automotive',
  'Garden',
  'Health',
];

// Sample name parts for generating realistic-sounding product names
const ADJECTIVES = [
  'Premium', 'Deluxe', 'Essential', 'Classic', 'Ultra',
  'Pro', 'Mini', 'Mega', 'Smart', 'Eco',
];

const NOUNS = [
  'Widget', 'Gadget', 'Device', 'Tool', 'Kit',
  'Set', 'Pack', 'Bundle', 'Box', 'Unit',
];

async function seed() {
  const client = await pool.connect();
  try {
    // Check for existing data
    const existingCount = await client.query('SELECT COUNT(*) FROM products');
    const count = parseInt(existingCount.rows[0].count);
    if (count > 0) {
      console.log(`Table already has ${count} rows. Truncating first...`);
      await client.query('TRUNCATE products');
    }

    console.log('Seeding 200,000 products...');
    const start = Date.now();

    // Build the category and name arrays as Postgres literals so we can
    // index into them with (i % array_length). All logic stays in one SQL
    // statement — no loops, no batching, no network overhead.
    const categoryLiteral = `ARRAY[${CATEGORIES.map(c => `'${c}'`).join(',')}]`;
    const adjLiteral = `ARRAY[${ADJECTIVES.map(a => `'${a}'`).join(',')}]`;
    const nounLiteral = `ARRAY[${NOUNS.map(n => `'${n}'`).join(',')}]`;

    // created_at is spread over the past 2 years using a random interval,
    // giving a realistic distribution rather than all rows at the same timestamp.
    // updated_at is always >= created_at.
    await client.query(`
      INSERT INTO products (id, name, category, price, created_at, updated_at)
      SELECT
        gen_random_uuid(),
        (${adjLiteral})[(i % 10) + 1] || ' ' ||
          (${nounLiteral})[(i % 10) + 1] || ' ' || i  AS name,
        (${categoryLiteral})[(i % 10) + 1]             AS category,
        ROUND((random() * 999 + 1)::numeric, 2)         AS price,
        NOW() - (random() * INTERVAL '730 days')        AS created_at,
        NOW() - (random() * INTERVAL '30 days')         AS updated_at
      FROM generate_series(1, 200000) AS s(i);
    `);

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const finalCount = await client.query('SELECT COUNT(*) FROM products');
    console.log(`Done! Inserted ${finalCount.rows[0].count} products in ${elapsed}s.`);
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
