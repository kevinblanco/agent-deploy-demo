// Cart pricing. All money is integer cents.
//
// The rules come from the finance spec, and the contract checks in
// contract/ hold the service to them:
//   1. subtotal = sum(unitPrice × qty)
//   2. a discount code takes a percentage off the subtotal, never off tax
//   3. every rounding step rounds half up to the nearest cent
//   4. tax = taxRate × the discounted subtotal
//   5. total = discounted subtotal + tax

export const DISCOUNT_CODES = Object.freeze({
  SAVE10: 10, // percent
  WELCOME5: 5,
});

export class PricingError extends Error {}

// Half-up rounding to a whole cent.
const roundCents = (value) => Math.round(value);

export function quote(items, { discountCode = null, taxRate = 0 } = {}) {
  if (!Array.isArray(items)) throw new PricingError("items must be an array");

  const subtotal = items.reduce((sum, item, i) => {
    const { unitPrice, qty } = item ?? {};
    if (!Number.isInteger(unitPrice) || unitPrice < 0) {
      throw new PricingError(`items[${i}].unitPrice must be a whole number of cents`);
    }
    if (!Number.isInteger(qty) || qty < 1) {
      throw new PricingError(`items[${i}].qty must be a positive integer`);
    }
    return sum + unitPrice * qty;
  }, 0);

  let percentOff = 0;
  if (discountCode) {
    percentOff = DISCOUNT_CODES[String(discountCode).toUpperCase()];
    if (percentOff === undefined) throw new PricingError(`unknown discount code: ${discountCode}`);
  }

  if (typeof taxRate !== "number" || taxRate < 0 || taxRate > 0.5) {
    throw new PricingError("taxRate must be a decimal between 0 and 0.5");
  }
  const taxBasisPoints = Math.round(taxRate * 10_000);

  const discount = roundCents((subtotal * percentOff) / 100);
  const discounted = subtotal - discount;
  const tax = roundCents((discounted * taxBasisPoints) / 10_000);

  return { subtotal, discount, tax, total: discounted + tax, currency: "USD" };
}
