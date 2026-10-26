import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt, amountsIn, findDate } from '../src/lib/receipt/parse.js';

const today = new Date(2026, 9, 26); // Oct 26 2026

test('grocery receipt: merchant, total, tax, date, items', () => {
  const text = `
COSTCO
WHOLESALE
Hamilton #548
1330 S Service Rd
Stoney Creek ON L8E 5C5
E 1234567 KS ORGANIC EGGS 8.99
E 789012 BANANAS 2.49
  445566 PAPER TOWEL 24.99 H
E 112233 MILK 2L 5.79
SUBTOTAL 42.26
HST 13% 3.25
**** TOTAL 45.51
VISA TEND 45.51
CHANGE 0.00
10/18/2026 14:22
`;
  const r = parseReceipt(text, { today });
  assert.equal(r.merchant, 'Costco');
  assert.equal(r.category, 'groceries');
  assert.equal(r.totalCents, 4551);
  assert.equal(r.confidence.total, 'high');
  assert.equal(r.subtotalCents, 4226);
  assert.equal(r.taxCents, 325);
  assert.equal(r.date, '2026-10-18');
  assert.deepEqual(r.items.map((i) => i.cents), [899, 249, 2499, 579]);
  assert.equal(r.items[2].name, 'Paper Towel');
  assert.match(r.description, /Bananas: \$2\.49/);
});

test('restaurant with tip and messy OCR', () => {
  const text = `
The Burnt Toast Cafe
(905) 555-0199
Server: Alex   Table 12
Oct 22, 2026  7:41 PM
2 Burger 32.OO
1 Fries 6.5O
1 Lemonade 4. 25
Subtotal S42.75
GST/HST 5.56
Tip 8.00
Total $56.31
Mastercard $56.31
`;
  const r = parseReceipt(text, { today });
  assert.equal(r.merchant, 'The Burnt Toast Cafe');
  assert.equal(r.category, 'food');
  assert.equal(r.totalCents, 5631);
  assert.equal(r.tipCents, 800);
  assert.equal(r.date, '2026-10-22');
  assert.equal(r.items.length, 3);
  assert.equal(r.items[0].cents, 3200);
  assert.equal(r.items[2].cents, 425);
});

test('utility bill: amount due wins over other numbers', () => {
  const text = `
Alectra Utilities
Account Number 1234 5678 90
Billing period Sep 12, 2026 - Oct 11, 2026
Electricity 98.40
Delivery 22.10
HST 15.67
Previous balance 0.00
Amount Due $136.17
Due date: Nov 4, 2026
`;
  const r = parseReceipt(text, { today });
  assert.equal(r.merchant, 'Alectra');
  assert.equal(r.category, 'utilities');
  assert.equal(r.totalCents, 13617);
  assert.equal(r.date, '2026-10-11', 'future due date is ignored');
});

test('cash payment: tendered amount is not the total', () => {
  const r = parseReceipt(`NO FRILLS\nBREAD 3.49\nTOTAL 3.49\nCASH 20.00\nCHANGE 16.51`, { today });
  assert.equal(r.totalCents, 349);
  assert.equal(r.merchant, 'No Frills');
});

test('no total keyword: falls back to subtotal+tax, then largest amount', () => {
  assert.equal(parseReceipt('Shop\nSub-total 10.00\nHST 1.30', { today }).totalCents, 1130);
  assert.equal(parseReceipt('Corner store\nchips 2.50\nsoda 1.99', { today }).totalCents, 250);
});

test('OCR typo in merchant still matches', () => {
  assert.equal(parseReceipt('C0STC0 WH0LESALE\nTOTAL 10.00', { today }).merchant, 'Costco');
  assert.equal(parseReceipt('Walrnart Supercentre\nTOTAL 10.00', { today }).merchant, 'Walmart');
});

test('amount and date helpers', () => {
  assert.deepEqual(amountsIn('Item 1,234.56').map((a) => a.cents), [123456]);
  assert.deepEqual(amountsIn('Coupon 2.00-').map((a) => a.cents), [-200]);
  assert.deepEqual(amountsIn('HST 13% 3.25').map((a) => a.cents), [325]);
  assert.equal(findDate(['2026-10-01'], today), '2026-10-01');
  assert.equal(findDate(['26/10/2026'], today), '2026-10-26');
  assert.equal(findDate(['26 Oct 26'], today), '2026-10-26');
  assert.equal(findDate(['12/31/2029'], today), null);
});

test('empty input is safe', () => {
  const r = parseReceipt('', { today });
  assert.equal(r.totalCents, null);
  assert.equal(r.merchant, null);
  assert.deepEqual(r.items, []);
});
