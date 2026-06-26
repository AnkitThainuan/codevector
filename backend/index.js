const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('neon') || process.env.DATABASE_URL?.includes('supabase')
    ? { rejectUnauthorized: false }
    : false,
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'CodeVector Product API' });
});


app.get('/products', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const category = req.query.category || null;
    const cursorParam = req.query.cursor || null;

    let cursorCreatedAt = null;
    let cursorId = null;

    if (cursorParam) {
      try {
        const decoded = Buffer.from(cursorParam, 'base64').toString('utf8');
        const parsed = JSON.parse(decoded);
        cursorCreatedAt = parsed.created_at;
        cursorId = parsed.id;
      } catch {
        return res.status(400).json({ error: 'Invalid cursor' });
      }
    }

    
    const values = [];
    let paramIdx = 1;

    let whereClause = '';
    const conditions = [];

    if (cursorCreatedAt && cursorId) {
     
      conditions.push(`(created_at, id) < ($${paramIdx++}::timestamptz, $${paramIdx++}::uuid)`);
      values.push(cursorCreatedAt, cursorId);
    }

    if (category) {
      conditions.push(`category = $${paramIdx++}`);
      values.push(category);
    }

    if (conditions.length > 0) {
      whereClause = 'WHERE ' + conditions.join(' AND ');
    }

    values.push(limit + 1); // fetch one extra to know if there's a next page

    const query = `
      SELECT id, name, category, price, created_at, updated_at
      FROM products
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT $${paramIdx}
    `;

    const result = await pool.query(query, values);
    const rows = result.rows;

    const hasNextPage = rows.length > limit;
    const items = hasNextPage ? rows.slice(0, limit) : rows;

    // Build next cursor from the last item returned
    let nextCursor = null;
    if (hasNextPage && items.length > 0) {
      const last = items[items.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({ created_at: last.created_at, id: last.id })
      ).toString('base64');
    }

    res.json({
      items,
      nextCursor,
      hasNextPage,
      count: items.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /categories — list all distinct categories
app.get('/categories', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT DISTINCT category FROM products ORDER BY category'
    );
    res.json({ categories: result.rows.map(r => r.category) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
