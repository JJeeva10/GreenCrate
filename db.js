'use strict';
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

const SEED_PRODUCTS = [
  ['Tomato', 'vegetables', 40, 'kg', 84, '🍅'],
  ['Spinach', 'vegetables', 25, 'bunch', 46, '🥬'],
  ['Onion', 'vegetables', 35, 'kg', 120, '🧅'],
  ['Carrot', 'vegetables', 42, 'kg', 63, '🥕'],
  ['Capsicum', 'vegetables', 60, 'kg', 8, '🫑'],
  ['Cauliflower', 'vegetables', 35, 'piece', 27, '🥦'],
  ['Mango', 'fruits', 90, 'kg', 54, '🥭'],
  ['Banana', 'fruits', 50, 'dozen', 71, '🍌'],
  ['Papaya', 'fruits', 35, 'kg', 5, '🫒'],
  ['Pomegranate', 'fruits', 150, 'kg', 32, '🍎'],
];

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price NUMERIC NOT NULL,
      unit TEXT NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      emoji TEXT
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      items JSONB NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      pincode TEXT NOT NULL,
      subtotal NUMERIC NOT NULL,
      delivery_fee NUMERIC NOT NULL,
      total NUMERIC NOT NULL,
      payment_method TEXT NOT NULL,
      payment_status TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'placed',
      placed_at TIMESTAMPTZ DEFAULT now()
    )`);

  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM products');
  if (rows[0].n === 0) {
    for (const [name, category, price, unit, stock, emoji] of SEED_PRODUCTS) {
      await pool.query(
        'INSERT INTO products (name, category, price, unit, stock, emoji) VALUES ($1,$2,$3,$4,$5,$6)',
        [name, category, price, unit, stock, emoji]
      );
    }
  }
}

module.exports = { pool, init };
