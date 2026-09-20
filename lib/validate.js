'use strict';

function validateDeliveryDetails({ name, phone, address, city, pincode } = {}) {
  const errors = [];
  if (!name || !name.trim()) errors.push('name is required');
  if (!phone || !/^\d{10}$/.test(phone)) errors.push('phone must be exactly 10 digits');
  if (!address || !address.trim()) errors.push('address is required');
  if (!city || !city.trim()) errors.push('city is required');
  if (!pincode || !/^\d{6}$/.test(pincode)) errors.push('pincode must be exactly 6 digits');
  return errors;
}

module.exports = { validateDeliveryDetails };
