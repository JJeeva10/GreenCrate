'use strict';
const crypto = require('crypto');

const FREE_DELIVERY_THRESHOLD = 300;
const DELIVERY_FEE = 25;

function validateStock(items, products) {
  for (const line of items) {
    const product = products.find(p => p.id === line.productId);
    if (!product) throw new Error(`Unknown product id ${line.productId}`);
    if (line.qty <= 0) throw new Error(`Invalid quantity for ${product.name}`);
    if (product.stock < line.qty) throw new Error(`${product.name} is out of stock (${product.stock} left)`);
  }
}

function calculateOrderTotals(items, products) {
  const subtotal = items.reduce((sum, line) => {
    const product = products.find(p => p.id === line.productId);
    return sum + product.price * line.qty;
  }, 0);
  const deliveryFee = subtotal > 0 && subtotal < FREE_DELIVERY_THRESHOLD ? DELIVERY_FEE : 0;
  return { subtotal, deliveryFee, total: subtotal + deliveryFee };
}

function verifyPaymentSignature(orderId, paymentId, signature, secret) {
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature || '');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { validateStock, calculateOrderTotals, verifyPaymentSignature, FREE_DELIVERY_THRESHOLD, DELIVERY_FEE };
