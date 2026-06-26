

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

  
    const categoryLiteral = `ARRAY[${CATEGORIES.map(c => `'${c}'`).join(',')}]`;
    const adjLiteral = `ARRAY[${ADJECTIVES.map(a => `'${a}'`).join(',')}]`;
    const nounLiteral = `ARRAY[${NOUNS.map(n => `'${n}'`).join(',')}]`;

    
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
