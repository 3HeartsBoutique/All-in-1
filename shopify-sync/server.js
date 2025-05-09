const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const shopDomain = process.env.SHOPIFY_STORE_DOMAIN;
const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

// Enable SSL for Heroku Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 1️⃣ Run migrations: create tables if they don't exist
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
  // use string concatenation instead of backticks
  const url = 'https://' + shopDomain + '/admin/api/2025-04/products.json?limit=250';
  const resp = await axios.get(url, {
    headers: { 'X-Shopify-Access-Token': accessToken }
  });
  return resp.data.products;
}

async function syncProducts() {
  try {
    const products = await fetchProducts();

    for (const p of products) {
      const sku = p.variants[0].sku || 'SKU-' + p.id;

      // upsert into products
      await pool.query(
        `INSERT INTO products (sku, title, brand, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT (sku) DO UPDATE 
           SET title = EXCLUDED.title, updated_at = NOW()`,
        [sku, p.title, p.vendor]
      );

      // calculate total inventory
      const totalInv = p.variants.reduce((sum, v) => sum + v.inventory_quantity, 0);

      // upsert into listings
      await pool.query(
        `INSERT INTO listings (product_id, channel, listing_id, listing_url, inventory_count, status, last_scrape_at)
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
               status = EXCLUDED.status,
               last_scrape_at = NOW()`,
        [
          sku,
          p.variants[0].id.toString(),
          'https://' + shopDomain + '/admin/products/' + p.id,
          totalInv
        ]
      );
    }

    console.log('Synced ' + products.length + ' products.');

  } catch (err) {
    console.error('Error syncing Shopify:', err);
  }
}

app.get('/sync/shopify', async (req, res) => {
  // ensure tables exist, then sync
  await initDb();
  await syncProducts();
  res.send('Shopify sync complete');
});

app.listen(port, () => 
  console.log('Shopify sync service running on port ' + port)
);
