// Unit tests. Anyone can edit these, coding agents included. The rules
// that must never change live in contract/ and in the pipeline's verify step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { quote, PricingError } from "../src/pricing.js";

const keyboardAndMouse = [
  { sku: "KB-01", unitPrice: 1999, qty: 2 },
  { sku: "MS-02", unitPrice: 4999, qty: 1 },
];

test("subtotal is the sum of unit price × quantity", () => {
  assert.equal(quote(keyboardAndMouse).subtotal, 8997);
});

test("no discount and no tax: total equals subtotal", () => {
  const q = quote(keyboardAndMouse);
  assert.deepEqual([q.discount, q.tax, q.total], [0, 0, 8997]);
});

test("SAVE10 takes 10% off the subtotal, truncated to the cent", () => {
  assert.equal(quote(keyboardAndMouse, { discountCode: "SAVE10" }).discount, 899);
});

test("discount codes are case-insensitive", () => {
  assert.equal(quote(keyboardAndMouse, { discountCode: "save10" }).discount, 899);
});

test("tax applies to the discounted subtotal", () => {
  const q = quote(keyboardAndMouse, { discountCode: "SAVE10", taxRate: 0.0825 });
  assert.deepEqual([q.discount, q.tax, q.total], [899, 668, 8766]);
});

test("unknown discount codes are rejected", () => {
  assert.throws(() => quote(keyboardAndMouse, { discountCode: "FREE100" }), PricingError);
});

test("quantities must be positive integers", () => {
  assert.throws(() => quote([{ unitPrice: 100, qty: 0 }]), PricingError);
});
