const path = require('path');
const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const multer = require('multer');
const bwipjs = require('bwip-js');
const { Configuration, OpenAIApi } = require('openai');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Serve React build
app.use(express.static(path.join(__dirname, '../ui/build')));

// Postgres pool with SSL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Multer for file uploads
const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 } });
// OpenAI client
const openai = new OpenAIApi(new Configuration({
  apiKey: process.env.OPENAI_API_KEY
}));

// 1) Create tables if they don't exist
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
}

// 2) Fetch products from Shopify
async function fetchProducts() {
  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  const url = 'https://' + shop + '/admin/api/2025-04/products.json?limit=250';
  const resp = await axios.get(url, { headers: { 'X-Shopify-Access-Token': token } });
  return resp.data.products;
}

// 3) Sync products and listings into Postgres
async function syncProducts() {
  const products = await fetchProducts();
  for (const p of products) {
    const sku = p.variants[0].sku || 'SKU-' + p.id;
    
    // Upsert product
    await pool.query(
      `INSERT INTO products (sku, title, brand, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (sku) DO UPDATE SET title = EXCLUDED.title, updated_at = NOW()`,
      [sku, p.title, p.vendor]
    );

    // Calculate inventory
    const inv = p.variants.reduce((sum, v) => sum + v.inventory_quantity, 0);

    // Upsert listing
    await pool.query(
      `INSERT INTO listings (product_id, channel, listing_id, listing_url, inventory_count, status, last_scrape_at)
       VALUES ((SELECT id FROM products WHERE sku = $1), 'shopify', $2, $3, $4, 'active', NOW())
       ON CONFLICT (channel, listing_id) DO UPDATE
         SET inventory_count = EXCLUDED.inventory_count,
             status = EXCLUDED.status,
             last_scrape_at = NOW()`,
      [
        sku,
        p.variants[0].id.toString(),
        'https://' + process.env.SHOPIFY_STORE_DOMAIN + '/admin/products/' + p.id,
        inv
      ]
    );
  }
  console.log('Synced ' + products.length + ' products.');
}

// Route: Shopify sync
app.get('/sync/shopify', async (req, res) => {
  await initDb();
  await syncProducts();
  res.send('Shopify sync complete');
});

// Enrichment endpoint: upload photos, generate SKU, barcode, SEO
app.post(
  '/api/enrich',
  upload.array('photos'),
  async (req, res) => {
    try {
      // 1) Simple SKU
      const sku = 'SKU-' + Date.now();

      // 2) Barcode PNG
      const png = await bwipjs.toBuffer({
        bcid: 'code128',
        text: sku,
        scale: 3,
        height: 10,
        includetext: true,
        textxalign: 'center',
      });
      const barcode = 'data:image/png;base64,' + png.toString('base64');

      // 3) OpenAI SEO
      const names = req.files.map(f => f.originalname).join(', ');
      const chat = await openai.createChatCompletion({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are an SEO expert for a high-end fashion boutique.' },
          { role: 'user', content:
            `Product images: ${names}. Generate a concise (≤60 chars) product title and a friendly SEO description (≤160 chars).`
          }
        ],
        temperature: 0.7,
      });
      const lines = chat.data.choices[0].message.content
        .split('\n')
        .filter(l => l.trim());
      const title = lines[0] || '';
      const description = lines[1] || '';

      // 4) Response JSON
      res.json({ sku, barcode, seo: { title, description } });

    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Enrichment failed' });
    }
  }
);

// Fallback: serve React app
app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, '../ui/build/index.html'))
);

// Start server
app.listen(port, () => console.log('Running on port ' + port));
