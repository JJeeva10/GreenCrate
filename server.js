'use strict';
const http = require('node:http');
const https = require('node:https');
const { randomUUID } = require('node:crypto');
const { pool, init } = require('./db');
const { validateStock, calculateOrderTotals, verifyPaymentSignature } = require('./lib/pricing');
const { validateDeliveryDetails } = require('./lib/validate');

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_XXXXXXXXXXXX';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'YOUR_TEST_SECRET';
const API_KEY = process.env.API_KEY || null;
const STAGES = ['placed', 'packed', 'out_for_delivery', 'delivered'];

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function checkAuth(req) {
  if (!API_KEY) return true;
  return req.headers['x-api-key'] === API_KEY;
}

function razorpayCreateOrder(amountInRupees, receipt) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ amount: Math.round(amountInRupees * 100), currency: 'INR', receipt });
    const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
    const req = https.request({
      hostname: 'api.razorpay.com', path: '/v1/orders', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), Authorization: `Basic ${auth}` },
      timeout: 6000,
    }, res => {
      let data = ''; res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('Razorpay request timed out after 6s')));
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

function productRow(r) {
  return { id: r.id, name: r.name, category: r.category, price: Number(r.price), unit: r.unit, stock: r.stock, emoji: r.emoji };
}
function orderRow(r) {
  return {
    id: r.id, items: r.items, name: r.name, phone: r.phone, address: r.address, city: r.city, pincode: r.pincode,
    subtotal: Number(r.subtotal), deliveryFee: Number(r.delivery_fee), total: Number(r.total),
    paymentMethod: r.payment_method, paymentStatus: r.payment_status, status: r.status, placedAt: r.placed_at,
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (!checkAuth(req)) return send(res, 401, { error: 'Missing or invalid X-API-Key' });

  try {
    if (path === '/api/products' && req.method === 'GET') {
      const category = url.searchParams.get('category');
      const { rows } = category
        ? await pool.query('SELECT * FROM products WHERE category = $1 ORDER BY id', [category])
        : await pool.query('SELECT * FROM products ORDER BY id');
      return send(res, 200, rows.map(productRow));
    }

    if (path === '/api/inventory/low-stock' && req.method === 'GET') {
      const { rows } = await pool.query('SELECT * FROM products WHERE stock <= 10 ORDER BY stock');
      return send(res, 200, rows.map(productRow));
    }

    if (path.match(/^\/api\/inventory\/\d+$/) && req.method === 'PATCH') {
      const id = Number(path.split('/').pop());
      const { stock } = await readBody(req);
      if (typeof stock !== 'number' || stock < 0) return send(res, 400, { error: 'Invalid stock value' });
      const { rows } = await pool.query('UPDATE products SET stock = $1 WHERE id = $2 RETURNING *', [stock, id]);
      if (!rows.length) return send(res, 404, { error: 'Product not found' });
      return send(res, 200, productRow(rows[0]));
    }

    if (path === '/api/orders' && req.method === 'POST') {
      const body = await readBody(req);
      const { items, paymentMethod } = body;
      if (!items?.length) return send(res, 400, { error: 'Cart is empty' });

      const deliveryErrors = validateDeliveryDetails(body);
      if (deliveryErrors.length) return send(res, 400, { error: 'Invalid delivery details', details: deliveryErrors });

      const ids = items.map(l => l.productId);
      const { rows: productRows } = await pool.query('SELECT * FROM products WHERE id = ANY($1)', [ids]);
      const products = productRows.map(productRow);

      try {
        validateStock(items, products);
      } catch (e) {
        return send(res, 409, { error: e.message });
      }

      const { subtotal, deliveryFee, total } = calculateOrderTotals(items, products);
      const id = 'GC' + randomUUID().slice(0, 8).toUpperCase();
      const paymentStatus = paymentMethod === 'cod' ? 'pending_on_delivery' : 'awaiting_payment';

      await pool.query(
        `INSERT INTO orders (id, items, name, phone, address, city, pincode, subtotal, delivery_fee, total, payment_method, payment_status, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'placed')`,
        [id, JSON.stringify(items), body.name, body.phone, body.address, body.city, body.pincode, subtotal, deliveryFee, total, paymentMethod, paymentStatus]
      );

      if (paymentMethod === 'cod') {
        for (const line of items) {
          await pool.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [line.qty, line.productId]);
        }
      }

      const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
      return send(res, 201, orderRow(rows[0]));
    }

    const orderMatch = path.match(/^\/api\/orders\/([\w-]+)$/);
    if (orderMatch && req.method === 'GET') {
      const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [orderMatch[1]]);
      if (!rows.length) return send(res, 404, { error: 'Order not found' });
      return send(res, 200, orderRow(rows[0]));
    }

    const statusMatch = path.match(/^\/api\/orders\/([\w-]+)\/status$/);
    if (statusMatch && req.method === 'PATCH') {
      const { status } = await readBody(req);
      if (!STAGES.includes(status)) return send(res, 400, { error: `status must be one of ${STAGES.join(', ')}` });
      const { rows } = await pool.query('UPDATE orders SET status = $1 WHERE id = $2 RETURNING *', [status, statusMatch[1]]);
      if (!rows.length) return send(res, 404, { error: 'Order not found' });
      return send(res, 200, orderRow(rows[0]));
    }

    if (path === '/api/payments/create-order' && req.method === 'POST') {
      const { amountInRupees, receiptOrderId } = await readBody(req);
      try {
        return send(res, 200, await razorpayCreateOrder(amountInRupees, receiptOrderId));
      } catch (e) {
        return send(res, 502, { error: 'Could not reach Razorpay', details: e.message });
      }
    }

    if (path === '/api/payments/verify' && req.method === 'POST') {
      const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = await readBody(req);
      const ok = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature, RAZORPAY_KEY_SECRET);
      if (!ok) return send(res, 400, { error: 'Payment verification failed' });

      const { rows } = await pool.query(`UPDATE orders SET payment_status = 'paid' WHERE id = $1 RETURNING *`, [orderId]);
      if (!rows.length) return send(res, 404, { error: 'Order not found' });
      const order = orderRow(rows[0]);
      for (const line of order.items) {
        await pool.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [line.qty, line.productId]);
      }
      return send(res, 200, { verified: true, order });
    }

    return send(res, 404, { error: 'Not found' });
  } catch (err) {
    if (err.message === 'Invalid JSON body') return send(res, 400, { error: err.message });
    console.error(err);
    return send(res, 500, { error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 4000;
if (require.main === module) {
  init()
    .then(() => server.listen(PORT, () => console.log(`GreenCrate API (live DB) running on :${PORT}`)))
    .catch(e => { console.error('DB init failed:', e.message); process.exit(1); });
}
module.exports = server;
