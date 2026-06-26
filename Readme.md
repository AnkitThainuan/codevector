# CodeVector Product API

A backend for browsing ~200,000 products, with stable cursor-based pagination, category filtering, and a bonus UI.

**Live demo:** [https://your-backend.onrender.com](https://your-backend.onrender.com)  
**Frontend:** [https://your-frontend.vercel.app](https://your-frontend.vercel.app)

---

## The Core Problem

The task says: *"If 50 new products are added while someone is browsing, they must not see the same product twice or miss one."*

This rules out **offset pagination** (`LIMIT 20 OFFSET 400`). Here's why:

```
Page 1: rows 1–20         ← user reads this
-- 50 new products inserted at the top --
Page 2: rows 1–20 again   ← offset 20 now points to what was rows 21-40,
                             but the new rows shifted everything. User sees
                             some of page 1 again.
```

The fix is **cursor-based pagination**.

---

## Solution: Cursor Pagination

Instead of asking for "rows 401–420", we ask for "rows that come after this specific row".

### How it works

1. Sort all products by `(created_at DESC, id DESC)` — newest first.
2. The first page has no cursor; just fetch the top N rows.
3. The response includes a `nextCursor` — an opaque base64 token encoding `{ created_at, id }` of the last item returned.
4. The next page query is:

```sql
SELECT * FROM products
WHERE (created_at, id) < ($cursor_created_at, $cursor_id)
ORDER BY created_at DESC, id DESC
LIMIT 21
```

5. Fetch `limit + 1` rows — if you get 21 back when you asked for 20, there's a next page; slice to 20 and save the cursor.

### Why this is stable

The cursor points to a **fixed row in the dataset**, not a position number. New rows inserted *above* the cursor (they're newer) don't move it. You get the same next page regardless of what's been added.

### The composite index

```sql
CREATE INDEX idx_products_cursor ON products (created_at DESC, id DESC);
CREATE INDEX idx_products_category_cursor ON products (category, created_at DESC, id DESC);
```

PostgreSQL can satisfy the `WHERE (created_at, id) < (x, y) ORDER BY created_at DESC, id DESC LIMIT N` query entirely from the index — no table scan. On 200k rows this is typically 1–5ms.

The `id` in the cursor handles ties: if two products have the exact same `created_at`, `id` (a UUID) acts as a tiebreaker to ensure a stable, total ordering. Without it, rows could appear on two different pages.

---

## Database Choice: PostgreSQL

- Row comparison syntax `(col1, col2) < ($1, $2)` is clean and efficient
- Composite indexes work exactly as needed
- Free tier on Neon/Supabase is plenty for 200k rows
- UUID generation (`gen_random_uuid()`) is built in

---

## Seed Script

Rather than inserting 200k rows one at a time from Node.js (which would be slow), the seed script uses a **single SQL statement** with `generate_series()`:

```sql
INSERT INTO products (id, name, category, price, created_at, updated_at)
SELECT
  gen_random_uuid(),
  adjectives[(i % 10) + 1] || ' ' || nouns[(i % 10) + 1] || ' ' || i,
  categories[(i % 10) + 1],
  ROUND((random() * 999 + 1)::numeric, 2),
  NOW() - (random() * INTERVAL '730 days'),
  NOW() - (random() * INTERVAL '30 days')
FROM generate_series(1, 200000) AS s(i);
```

All 200,000 rows are generated entirely inside PostgreSQL — no round-trips, no JS loop overhead. Completes in ~5–15 seconds on a free Neon instance.

---

## API Endpoints

### `GET /products`

| Param | Type | Description |
|-------|------|-------------|
| `limit` | number | Items per page (default: 20, max: 100) |
| `cursor` | string | Opaque cursor from previous response |
| `category` | string | Filter by exact category name |

**Response:**
```json
{
  "items": [{ "id", "name", "category", "price", "created_at", "updated_at" }],
  "nextCursor": "eyJjcmVhdGVkX2...",
  "hasNextPage": true,
  "count": 20
}
```

### `GET /categories`

Returns all distinct category values for populating filter dropdowns.

---

## Setup

```bash
# 1. Install deps
npm install

# 2. Create .env
cp .env.example .env
# fill in DATABASE_URL

# 3. Create table and indexes
npm run db:schema

# 4. Seed 200k products
npm run db:seed

# 5. Start server
npm start
```

---

## Deployment

**Backend → Render (free)**
1. Push to GitHub
2. New Web Service → connect repo → build: `npm install`, start: `npm start`
3. Add `DATABASE_URL` env var

**Frontend → Vercel / Netlify (free)**
1. Update `API_BASE` in `frontend/index.html` to your Render URL
2. Deploy the `frontend/` folder

---

## What I'd improve with more time

1. **Prev page without a stack**: The current approach stores cursor history client-side. A proper solution could encode page numbers into signed tokens so you can jump to any page (with the tradeoff that you lose true stability guarantees for arbitrary jumps).

2. **Search**: Full-text search on `name` using PostgreSQL `tsvector` + GIN index.

3. **Rate limiting**: `express-rate-limit` on the API.

4. **Response caching**: Since products don't change every millisecond, a short-lived Redis or in-memory cache on the first page (no cursor, no category) would cut DB load significantly.

5. **updated_at index**: If "recently updated" sort order were needed, a separate index on `updated_at DESC` would be trivial to add.

---

## How I used AI

I used Claude to:
- Write the boilerplate Express server structure and HTML/CSS UI faster than I could type
- Double-check my SQL row comparison syntax (`(a, b) < ($1, $2)` — I knew this worked in Postgres but wanted to confirm the index could satisfy it)
- Generate the seed script's `generate_series` approach (I knew bulk insert was the right idea; Claude helped with the exact SQL syntax for `ARRAY[...][(i % n) + 1]` indexing)

What I caught / corrected:
- Claude's initial seed script used `OFFSET` in a loop as a fallback. I removed it — the whole point is one query.
- The initial cursor encoding used a simple comma-separated string. I changed it to base64-encoded JSON so it's properly opaque and handles edge cases (commas in values, etc.)
- The initial index was only on `(created_at DESC)` — I added `id` to the composite index to ensure the tiebreaker works and the query planner can use it.
