import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const B = require('./bills-model.js');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = '2026-11-14';

function nov() {
  return B.sampleData(TODAY);
}

test('monthly bills roll into the next month unpaid, and a payment sticks to its month', function() {
  const data = nov();
  const novRows = B.instancesForMonth(data.bills, data.payments, '2026-11', TODAY);
  const payroll = novRows.find(function(r) { return r.billId === 'bill_payroll'; });
  assert.equal(payroll.status, 'paid');
  assert.equal(payroll.amountPaid, 8500);
  assert.equal(payroll.paidAt, '2026-11-01');
  const decRows = B.instancesForMonth(data.bills, data.payments, '2026-12', '2026-12-02');
  const next = decRows.find(function(r) { return r.billId === 'bill_payroll'; });
  assert.equal(next.status, 'overdue');
  assert.equal(next.paid, false);
  assert.equal(next.amountPaid, null);
  assert.equal(next.dueDate, '2026-12-01');
  assert.notEqual(B.paymentId('bill_payroll', '2026-11'), B.paymentId('bill_payroll', '2026-12'));
});

test('due day 31 clamps to the last day of a short month', function() {
  assert.equal(B.dueDateFor({ recurrence: 'monthly', dueDay: 31 }, '2026-02'), '2026-02-28');
  assert.equal(B.dueDateFor({ recurrence: 'monthly', dueDay: 31 }, '2024-02'), '2024-02-29');
  assert.equal(B.dueDateFor({ recurrence: 'monthly', dueDay: 31 }, '2026-11'), '2026-11-30');
});

test('one-time bills appear only in their due month', function() {
  const once = B.prepareTemplate({
    id: 'bill_once', name: 'Dumpster', category: 'Crew operating', amount: 80,
    recurrence: 'once', dueDate: '2026-11-18', type: 'fixed'
  }).bill;
  const novRows = B.instancesForMonth([once], [], '2026-11', TODAY);
  const decRows = B.instancesForMonth([once], [], '2026-12', '2026-12-01');
  assert.equal(novRows.length, 1);
  assert.equal(novRows[0].dueDate, '2026-11-18');
  assert.equal(novRows[0].status, 'due_soon');
  assert.equal(decRows.length, 0);
});

test('status is overdue, due soon (through 7 days), upcoming, or paid', function() {
  assert.equal(B.statusOf('2026-11-13', false, TODAY), 'overdue');
  assert.equal(B.statusOf('2026-11-14', false, TODAY), 'due_soon');
  assert.equal(B.statusOf('2026-11-21', false, TODAY), 'due_soon');
  assert.equal(B.statusOf('2026-11-22', false, TODAY), 'upcoming');
  assert.equal(B.statusOf('2026-11-01', true, TODAY), 'paid');
});

test('November sample summary matches the derived bills, not a hardcoded screen total', function() {
  const data = nov();
  const rows = B.sortInstances(B.instancesForMonth(data.bills, data.payments, '2026-11', TODAY));
  const sum = B.summarize(rows);
  assert.equal(sum.budget, 15200);
  assert.equal(sum.paid, 8500);
  assert.equal(sum.unpaid, 6700);
  assert.equal(sum.overdue, 3225);
  assert.equal(sum.overdueCount, 3);
  assert.equal(sum.dueSoon, 990);
  assert.equal(sum.dueSoonCount, 2);
  assert.deepEqual(rows.map(function(r) { return r.status; }).slice(0, 3), ['overdue', 'overdue', 'overdue']);
  const chase = B.balanceView(data.balances.chase0714, TODAY);
  const boa = B.balanceView(data.balances.boa1003, TODAY);
  assert.equal(chase.badge, 'unverified');
  assert.equal(boa.badge, 'unverified');
  assert.equal(B.cashAfter(chase.amount, boa.amount, sum.unpaid), 17830.55);
  const qb = B.invoiceSummary(data.invoices, TODAY, data.balances.quickbooks);
  assert.equal(qb.empty, false);
  assert.equal(qb.total, 4850);
  assert.equal(qb.count, 3);
  assert.equal(qb.overdue, 1);
  assert.equal(qb.badge, 'unverified');
  assert.equal(B.invoiceDaysOverdue(data.invoices[0], TODAY), 13);
  assert.equal(B.invoiceDaysOverdue(data.invoices[1], TODAY), 0);
});

test('missing balances stay empty and cash is not estimated from one account', function() {
  const missing = B.balanceView(null, TODAY);
  assert.equal(missing.amount, null);
  assert.equal(missing.badge, 'not_connected');
  assert.equal(B.money(null), '—');
  assert.equal(B.cashAfter(100, null, 40), null);
  assert.equal(B.cashAfter(null, 100, 40), null);
  const stale = B.balanceView({ amount: 10, asOf: '2026-01-01', source: 'connected' }, TODAY);
  assert.equal(stale.badge, 'unverified');
  const fresh = B.balanceView({ amount: 10, asOf: '2026-11-12', source: 'connected' }, TODAY);
  assert.equal(fresh.badge, '');
  const emptyQb = B.invoiceSummary([], TODAY, { source: 'manual', connected: false });
  assert.equal(emptyQb.empty, true);
  assert.equal(emptyQb.badge, 'not_connected');
  assert.equal(emptyQb.total, null);
  assert.equal(B.EMPTY_INVOICES_TITLE, 'Connect QuickBooks');
});

test('fixed bills do not prompt; card and variable bills do, and the payment records the typed amount', function() {
  assert.equal(B.needsAmountPrompt({ type: 'fixed', variableAmount: false }), false);
  assert.equal(B.needsAmountPrompt({ type: 'credit_card', variableAmount: false }), true);
  assert.equal(B.needsAmountPrompt({ type: 'fixed', variableAmount: true }), true);
  const inst = { billId: 'bill_affirm', month: '2026-11', amount: 175 };
  assert.equal(B.buildPayment(inst, '', '2026-11-14', 'a@b.c'), null);
  const pay = B.buildPayment(inst, 210.5, '2026-11-14', 'manager@example.com');
  assert.equal(pay.amountPaid, 210.5);
  assert.equal(pay.expectedAmount, 175);
  assert.equal(pay.paidBy, 'manager@example.com');
  assert.equal(pay.status, 'paid');
  assert.equal(pay.id, 'pay_bill_affirm_2026-11');
  const rows = B.instancesForMonth(
    [B.prepareTemplate({ id: 'bill_affirm', name: 'Affirm', category: 'Card minimums/Affirm', amount: 175, recurrence: 'monthly', dueDay: 22, type: 'credit_card' }).bill],
    [pay],
    '2026-11',
    TODAY
  );
  assert.equal(rows[0].status, 'paid');
  assert.equal(rows[0].amountPaid, 210.5);
  assert.equal(rows[0].amount, 175);
  const undone = B.instancesForMonth(
    [B.prepareTemplate({ id: 'bill_affirm', name: 'Affirm', category: 'Card minimums/Affirm', amount: 175, recurrence: 'monthly', dueDay: 22, type: 'credit_card' }).bill],
    [],
    '2026-11',
    TODAY
  );
  assert.equal(undone[0].status, 'upcoming');
  assert.equal(undone[0].paid, false);
});

test('category totals cover every approved category', function() {
  const data = nov();
  const rows = B.instancesForMonth(data.bills, data.payments, '2026-11', TODAY);
  const cats = B.byCategory(rows);
  assert.deepEqual(Object.keys(cats), B.CATEGORIES);
  assert.equal(cats.Payroll, 8500);
  assert.equal(cats['Card minimums/Affirm'], 175);
  assert.equal(B.CATEGORIES.length, 10);
});

test('template validation rejects a bad category and accepts a monthly bill', function() {
  assert.equal(B.prepareTemplate({ name: '', category: 'Payroll', amount: 1, recurrence: 'monthly', dueDay: 1 }).ok, false);
  assert.equal(B.prepareTemplate({ name: 'X', category: 'Nope', amount: 1, recurrence: 'monthly', dueDay: 1 }).ok, false);
  const ok = B.prepareTemplate({ name: 'Fuel', category: 'Fuel', amount: 12.5, recurrence: 'monthly', dueDay: 4, type: 'fixed', notes: 'ok' });
  assert.equal(ok.ok, true);
  assert.equal(ok.bill.amount, 12.5);
  assert.equal(ok.bill.dueDate, null);
  assert.equal(ok.bill.variableAmount, false);
});

test('sample import file validates and is labeled sample', function() {
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'data', 'bills.sample.json'), 'utf8'));
  assert.match(String(raw._comment), /SAMPLE/);
  const parsed = B.validateImport(raw);
  assert.equal(parsed.ok, true, parsed.errors.join('; '));
  assert.equal(parsed.bills.length, 10);
  assert.equal(parsed.invoices.length, 3);
  assert.equal(parsed.balances.chase0714.amount, 18420.55);
  assert.equal(parsed.payments.length, 1);
  assert.equal(parsed.payments[0].month, '2026-11');
});

test('the app does not subscribe crew to bill collections and blocks the tab', function() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /tab === 'bills' && state\.role !== 'manager'/);
  assert.match(html, /_ensureBillsListener/);
  assert.match(html, /_clearBills/);
  const critical = html.match(/var CRITICAL = \[([^\]]+)\]/);
  const secondary = html.match(/var SECONDARY = \[([^\]]+)\]/);
  assert.ok(critical && secondary);
  ['finance', 'bills', 'billPayments', 'financeInvoices'].forEach(function(name) {
    assert.equal(critical[1].includes("'" + name + "'"), false, name + ' in CRITICAL');
    assert.equal(secondary[1].includes("'" + name + "'"), false, name + ' in SECONDARY');
  });
  const crew = html.slice(html.indexOf('const CREW_MENU'), html.indexOf('function getCrewMenu'));
  assert.equal(crew.includes("tab:'bills'"), false);
  assert.equal(crew.includes('Bills & Expenses'), false);
  const rules = fs.readFileSync(path.join(root, 'firestore.bills.rules'), 'utf8');
  assert.match(rules, /match \/finance\/\{docId\}/);
  assert.match(rules, /match \/bills\/\{billId\}/);
  assert.match(rules, /match \/billPayments\/\{paymentId\}/);
  assert.match(rules, /match \/financeInvoices\/\{invoiceId\}/);
  assert.match(rules, /isManager\(\)/);
  assert.doesNotMatch(rules, /allow read: if request\.auth != null/);
});

test('seed script dry-run prints and does not open a socket, and --write refuses without the emulator', function() {
  const dry = spawnSync(process.execPath, ['scripts/seed-bills.mjs', 'data/bills.sample.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Dry run only/);
  assert.match(dry.stdout, /Bills: 10/);
  assert.match(dry.stdout, /SAMPLE/);
  const refused = spawnSync(process.execPath, ['scripts/seed-bills.mjs', '--write', 'data/bills.sample.json'], {
    cwd: root,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { FIRESTORE_EMULATOR_HOST: '' })
  });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /Refusing to write/);
  const prod = spawnSync(process.execPath, ['scripts/seed-bills.mjs', '--write'], {
    cwd: root,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' })
  });
  assert.equal(prod.status, 2);
  assert.match(prod.stderr, /production/);
});
