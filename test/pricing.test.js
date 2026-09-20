'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateStock, calculateOrderTotals, verifyPaymentSignature } = require('../lib/pricing');
const { validateDeliveryDetails } = require('../lib/validate');

const PRODUCTS = [
  { id: 1, name: 'Tomato', price: 40, stock: 5 },
  { id: 2, name: 'Mango', price: 90, stock: 0 },
];

test('calculateOrderTotals sums live prices, ignoring anything client-supplied', () => {
  const { subtotal, total, deliveryFee } = calculateOrderTotals([{ productId: 1, qty: 2 }], PRODUCTS);
  assert.equal(subtotal, 80);
  assert.equal(deliveryFee, 25);
  assert.equal(total, 105);
});

test('calculateOrderTotals waives delivery fee at/above the free threshold', () => {
  const { deliveryFee } = calculateOrderTotals([{ productId: 1, qty: 10 }], PRODUCTS);
  assert.equal(deliveryFee, 0);
});

test('validateStock throws a specific, identifiable message on insufficient stock', () => {
  assert.throws(() => validateStock([{ productId: 2, qty: 1 }], PRODUCTS), /Mango is out of stock/);
});

test('validateStock throws on an unknown product id', () => {
  assert.throws(() => validateStock([{ productId: 999, qty: 1 }], PRODUCTS), /Unknown product/);
});

test('validateStock passes for a valid, in-stock line', () => {
  assert.doesNotThrow(() => validateStock([{ productId: 1, qty: 2 }], PRODUCTS));
});

test('verifyPaymentSignature accepts a correctly-signed payload', () => {
  const secret = 'test_secret';
  const orderId = 'order_abc', paymentId = 'pay_xyz';
  const crypto = require('node:crypto');
  const validSig = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  assert.equal(verifyPaymentSignature(orderId, paymentId, validSig, secret), true);
});

test('verifyPaymentSignature rejects a tampered signature', () => {
  assert.equal(verifyPaymentSignature('order_abc', 'pay_xyz', 'deadbeef', 'test_secret'), false);
});

test('validateDeliveryDetails rejects a short/invalid phone number', () => {
  const errors = validateDeliveryDetails({ name: 'A', phone: '12345', address: 'x', city: 'x', pincode: '600001' });
  assert.ok(errors.includes('phone must be exactly 10 digits'));
});

test('validateDeliveryDetails rejects a malformed pincode', () => {
  const errors = validateDeliveryDetails({ name: 'A', phone: '9876543210', address: 'x', city: 'x', pincode: '6001' });
  assert.ok(errors.includes('pincode must be exactly 6 digits'));
});

test('validateDeliveryDetails passes on fully valid details', () => {
  const errors = validateDeliveryDetails({ name: 'A', phone: '9876543210', address: 'x', city: 'x', pincode: '600001' });
  assert.deepEqual(errors, []);
});
