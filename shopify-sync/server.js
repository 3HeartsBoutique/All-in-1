const path = require('path');
const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Serve React build
app.use(express.static(path.join(__dirname, '../ui/build')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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

async function fetchProducts() {
  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  const url = 'https://' + shop + '/admin/api/2025-04/products.json?limit=250';
  const resp = await axios.get(url, { headers: { 'X-Shopify-Access-Token': token } });
  return resp.data.products;
}

async function syncProducts() {
  const products = await fetchProducts();
  for (const p of products) {
    const sku = p.variants[0].sku || 'SKU-' + p.id;
    await pool.query(
      `INSERT INTO products (sku, title, brand, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (sku) DO UPDATE SET title = EXCLUDED.title, updated_at = NOW()`,
      [sku, p.title, p.vendor]
    );
    const inv = p.variants.reduce((s, v) => s + v.inventory_quantity, 0);
    await pool.query(
      `INSERT INTO listings (product_id, channel, listing_id, listing_url, inventory_count, status, last_scrape_at)
       VALUES ((SELECT id FROM products WHERE sku = $1), 'shopify', $2, $3, $4, 'active', NOW())
       ON CONFLICT (channel, listing_id) DO UPDATE
         SET inventory_count = EXCLUDED.inventory_count, status = EXCLUDED.status, last_scrape_at = NOW()`,
      [sku, p.variants[0].id.toString(), 'https://' + process.env.SHOPIFY_STORE_DOMAIN + '/admin/products/' + p.id, inv]
    );
  }
  console.log('Synced ' + products.length + ' products.');
}

app.get('/sync/shopify', async (req, res) => {
  await initDb();
  await syncProducts();
  res.send('Shopify sync complete');
});

// Send React for any other route:
app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, '../ui/build/index.html'))
);

app.listen(port, () => console.log('Running on port ' + port));
