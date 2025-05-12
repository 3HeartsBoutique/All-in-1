// shopify-sync/server.js

const path    = require('path');
const express = require('express');
const axios   = require('axios');
const { Pool } = require('pg');
const multer  = require('multer');
const bwipjs  = require('bwip-js');
const { OpenAI } = require('openai');
require('dotenv').config();

const app  = express();
const port = process.env.PORT || 3000;

// ─── 1) Serve React UI build ───────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../ui/build')));

// ─── 2) Postgres pool (Heroku SSL) ─────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ─── 3) DB migrations: products, listings, sales ───────────────────────────────
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      sku TEXT UNIQUE,
      title TEXT,
      brand TEXT,
      created_at TIMESTAMP,
      updated_at TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS listings (
      id SERIAL PRIMARY KEY,
      product_id INTEGER REFERENCES products(id),
      channel TEXT,
      listing_id TEXT,
      listing_url TEXT,
      inventory_count INTEGER,
      status TEXT,
      last_scrape_at TIMESTAMP,
      UNIQUE (channel, listing_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales (
      id SERIAL PRIMARY KEY,
      sku TEXT,
      title TEXT,
      sold_at TIMESTAMP,
      price NUMERIC
    );
  `);
}

// ─── 4) Shopify fetch & sync logic ─────────────────────────────────────────────
async function fetchProducts() {
  const shop  = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  const url   = `https://${shop}/admin/api/2025-04/products.json?limit=250`;
  const resp  = await axios.get(url, { headers: { 'X-Shopify-Access-Token': token } });
  return resp.data.products;
}

async function syncProducts() {
  const products = await fetchProducts();
  for (const p of products) {
    const sku = p.variants[0].sku || `SKU-${p.id}`;

    await pool.query(
      `INSERT INTO products (sku, title, brand, created_at, updated_at)
         VALUES ($1,$2,$3,NOW(),NOW())
       ON CONFLICT (sku) DO UPDATE
         SET title = EXCLUDED.title, updated_at = NOW()`,
      [sku, p.title, p.vendor]
    );

    const inv = p.variants.reduce((sum,v) => sum + v.inventory_quantity, 0);
    await pool.query(
      `INSERT INTO listings 
         (product_id, channel, listing_id, listing_url, inventory_count, status, last_scrape_at)
       VALUES (
         (SELECT id FROM products WHERE sku = $1),
         'shopify',
         $2,
         $3,
         $4,
         'active',
         NOW()
       )
       ON CONFLICT (channel, listing_id) DO UPDATE
         SET inventory_count = EXCLUDED.inventory_count,
             status          = EXCLUDED.status,
             last_scrape_at  = NOW()`,
      [
        sku,
        p.variants[0].id.toString(),
        `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/products/${p.id}`,
        inv,
      ]
    );
  }
  console.log(`Synced ${products.length} products.`);
}

// ─── 5) /sync/shopify endpoint ─────────────────────────────────────────────────
app.get('/sync/shopify', async (req, res) => {
  await initDb();
  await syncProducts();
  res.send('Shopify sync complete');
});

// ─── 6) File-upload + OpenAI setup ─────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── 7) /api/enrich (SKU + barcode + SEO) ─────────────────────────────────────
app.post('/api/enrich', upload.array('photos'), async (req, res) => {
  await initDb();
  try {
    // Generate a unique SKU and barcode
    const sku = `SKU-${Date.now()}`;
    const png = await bwipjs.toBuffer({
      bcid:        'code128',
      text:        sku,
      scale:       3,
      height:      10,
      includetext: true,
      textxalign:  'center',
    });
    const barcode = `data:image/png;base64,${png.toString('base64')}`;

    // Call OpenAI with vision-capable model and embed images
    const chat = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are an SEO expert for a high-end fashion boutique.' },
        {
          role: 'user',
          content:
            req.files
              .map(f =>
                `![${f.originalname}](data:${f.mimetype};base64,${f.buffer.toString('base64')})`
              )
              .join('\n')
            + '\nGenerate a concise (≤60 chars) title and SEO description (≤160 chars).'
        }
      ],
      temperature: 0.7,
    });

    // Extract title and description
    const lines       = chat.choices[0].message.content.split('\n').filter(l => l.trim());
    const title       = lines[0] || '';
    const description = lines[1] || '';

    res.json({ sku, barcode, seo: { title, description } });
  } catch (err) {
    console.error('Enrichment failed:', err);
    res.status(500).json({ error: 'Enrichment failed' });
  }
});

// ─── 8) /api/last-sold (10 most recent from `sales`) ────────────────────────────
app.get('/api/last-sold', async (req, res) => {
  await initDb();
  try {
    const { rows } = await pool.query(`
      SELECT
        sku,
        title,
        to_char(sold_at, 'YYYY-MM-DD HH24:MI') AS sold_at,
        price
      FROM sales
      ORDER BY sold_at DESC
      LIMIT 10
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching last-sold:', err);
    res.status(500).json({ error: 'Could not load last-sold items' });
  }
});

// ─── 9) Fallback to React UI ───────────────────────────────────────────────────
app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, '../ui/build/index.html'))
);

// ─── Bootstrap everything ──────────────────────────────────────────────────────
;(async () => {
  await initDb();
  app.listen(port, () =>
    console.log(`Running on port ${port}`)
  );
})();
