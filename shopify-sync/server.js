const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const shopDomain = process.env.SHOPIFY_STORE_DOMAIN;
const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function fetchProducts() {
  const url = `https://${shopDomain}/admin/api/2025-04/products.json?limit=250`;
  const resp = await axios.get(url, {
    headers: { 'X-Shopify-Access-Token': accessToken }
  });
  return resp.data.products;
}

async function syncProducts() {
  try {
    const products = await fetchProducts();
    for (const p of products) {
      const sku = p.variants[0].sku || `SKU-${p.id}`;
      await pool.query(
        `INSERT INTO products (sku, title, brand, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT (sku) DO UPDATE SET title = EXCLUDED.title, updated_at = NOW()`,
        [sku, p.title, p.vendor]
      );
      const totalInv = p.variants.reduce((sum, v) => sum + v.inventory_quantity, 0);
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
        [sku, p.variants[0].id.toString(), `https://${shopDomain}/admin/products/${p.id}`, totalInv]
      );
    }
    console.log(`Synced ${products.length} products.`);
  } catch (err) {
    console.error('Error syncing Shopify:', err);
  }
}

app.get('/sync/shopify', async (req, res) => {
  await syncProducts();
  res.send('Shopify sync complete');
});

app.listen(port, () => console.log(`Shopify sync service running on port ${port}`));
