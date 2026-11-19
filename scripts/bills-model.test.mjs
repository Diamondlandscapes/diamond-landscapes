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
  assert.equal(sum.budget, 14555);
  assert.equal(sum.paid, 9500);
  assert.equal(sum.unpaid, 5055);
  assert.equal(sum.overdue, 2225);
  assert.equal(sum.overdueCount, 3);
  assert.equal(sum.dueSoon, 640);
  assert.equal(sum.dueSoonCount, 1);
  assert.equal(rows.find(function(r) { return r.billId === 'bill_rent'; }).status, 'partial');
  assert.equal(rows.find(function(r) { return r.billId === 'bill_rent'; }).remaining, 1200);
  assert.deepEqual(rows.map(function(r) { return r.status; }).slice(0, 3), ['partial', 'overdue', 'overdue']);
  const chase = B.balanceView(data.balances.chase0714, TODAY);
  const boa = B.balanceView(data.balances.boa1003, TODAY);
  assert.equal(chase.badge, 'unverified');
  assert.equal(boa.badge, 'unverified');
  assert.equal(B.cashAfter(chase.amount, boa.amount, sum.unpaid), 19475.55);
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
  assert.equal(cats['Card minimums/Affirm'], 265);
  assert.equal(cats.Fuel, 0);
  assert.equal(cats['Crew operating'], 0);
  assert.equal(B.CATEGORIES.length, 10);
  assert.equal(rows.some(function(r) { return r.billId === 'bill_fuel_card'; }), false);
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
  assert.equal(parsed.bills.length, 15);
  assert.equal(parsed.invoices.length, 3);
  assert.equal(parsed.balances.chase0714.amount, 18420.55);
  assert.equal(parsed.payments.length, 2);
  assert.equal(parsed.payments[0].month, '2026-11');
  const plan = B.migrationPlan(raw.bills);
  assert.equal(plan.filter(function(r) { return r.action === 'reclassify_budget'; }).length, 4);
  assert.equal(plan.filter(function(r) { return r.action === 'needs_review'; }).length, 2);
  const minimum = plan.find(function(r) { return r.id === 'bill_cardmin'; });
  assert.equal(minimum.action, 'keep_bill');
  assert.equal(minimum.dueIsEstimate, true);
  assert.equal(minimum.amountIsEstimate, true);
});

test('the app does not subscribe crew to bill collections and blocks the tab', function() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /tab === 'bills' && state\.role !== 'manager'/);
  assert.match(html, /_ensureBillsListener/);
  assert.match(html, /_clearBills/);
  const critical = html.match(/var CRITICAL = \[([^\]]+)\]/);
  const secondary = html.match(/var SECONDARY = \[([^\]]+)\]/);
  assert.ok(critical && secondary);
  ['finance', 'bills', 'billPayments', 'financeInvoices', 'financeTransactions', 'financeAccounts'].forEach(function(name) {
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
  assert.doesNotMatch(rules, /financeTransactions/);
  assert.doesNotMatch(rules, /financeAccounts/);
  const budgetFn = html.slice(html.indexOf('function billsBudgetCard'), html.indexOf('function renderBills'));
  assert.doesNotMatch(budgetFn, /Mark paid/);
  assert.match(budgetFn, /Actual unknown/);
  assert.match(budgetFn, /not a bill/);
  assert.match(html, /Latest actual import/);
  assert.match(html, /financeTransactions/);
  assert.match(html, /state\.financeTransactions = \[\]/);
  assert.match(html, /slim\.financeTransactions = \[\]/);
});

test('seed script dry-run prints and does not open a socket, and --write refuses without the emulator', function() {
  const dry = spawnSync(process.execPath, ['scripts/seed-bills.mjs', 'data/bills.sample.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Dry run only/);
  assert.match(dry.stdout, /Templates: 15/);
  assert.match(dry.stdout, /Running budgets: 4/);
  assert.match(dry.stdout, /Needs review: 2/);
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

test('running budgets are not unpaid bills, and unknown actuals are not zero', function() {
  const data = nov();
  const picture = B.monthPicture(Object.assign({ today: TODAY, month: '2026-11' }, data));
  const fuel = picture.budgets.find(function(b) { return b.id === 'bill_fuel_card'; });
  const debit = picture.budgets.find(function(b) { return b.id === 'bill_fuel_debit'; });
  const supplies = picture.budgets.find(function(b) { return b.id === 'bill_supplies'; });
  assert.equal(fuel.actual.amount, 210);
  assert.equal(fuel.actual.state, 'incomplete');
  assert.equal(fuel.remaining, 590);
  assert.equal(debit.actual.state, 'ready');
  assert.equal(debit.actual.amount, 0);
  assert.equal(supplies.actual.state, 'unknown');
  assert.equal(supplies.actual.amount, null);
  assert.equal(supplies.remaining, null);
  assert.match(supplies.pace.text, /unknown/);
  assert.equal(picture.importMeta.live, false);
  assert.equal(picture.importMeta.present, true);
  const minimum = picture.instances.find(function(r) { return r.billId === 'bill_cardmin'; });
  assert.equal(minimum.estimateDue, true);
  assert.equal(minimum.estimateAmount, true);
  assert.equal(minimum.review, false);
});

test('cash forecast does not add a budget on top of spend or treat card purchases as bank cash', function() {
  const data = nov();
  const picture = B.monthPicture(Object.assign({ today: TODAY, month: '2026-11' }, data));
  const lines = picture.forecast.lines;
  const liability = lines.find(function(l) { return l.id === 'card-liability:capone-9618'; });
  const remaining = lines.find(function(l) { return l.id === 'card-remaining:bill_fuel_card'; });
  const dump = lines.find(function(l) { return l.id === 'bank-budget:bill_dump'; });
  assert.equal(liability.amount, 155);
  assert.equal(remaining.amount, 565);
  assert.equal(B.cents(liability.amount + remaining.amount), 720);
  assert.equal(B.cents(liability.amount + remaining.amount), 800 - 80);
  assert.ok(liability.amount + remaining.amount < 800 + 210);
  assert.equal(dump.amount, 160);
  assert.notEqual(dump.amount, 240);
  assert.equal(picture.forecast.totalOut, 5980);
  assert.equal(picture.forecast.cashAfter, 18550.55);
  assert.equal(picture.forecast.excluded[0].id, 'bill_supplies');
  assert.equal(picture.forecast.incomplete, true);
  const withoutPendingPurchase = B.monthPicture(Object.assign({ today: TODAY, month: '2026-11' }, data, {
    transactions: data.transactions.filter(function(tx) { return tx.sourceId !== 'sample-fuel-pending'; })
  }));
  assert.equal(withoutPendingPurchase.forecast.cashAfter, picture.forecast.cashAfter);
  const duplicated = data.transactions.concat([Object.assign({}, data.transactions[0])]);
  const again = B.monthPicture(Object.assign({ today: TODAY, month: '2026-11' }, data, { transactions: duplicated }));
  assert.equal(again.budgets.find(function(b) { return b.id === 'bill_fuel_card'; }).actual.amount, 210);
  assert.equal(again.forecast.cashAfter, picture.forecast.cashAfter);
  const transfer = data.transactions.find(function(tx) { return tx.kind === 'transfer'; });
  assert.equal(picture.forecast.lines.some(function(l) { return /transfer/i.test(l.label) && l.amount === transfer.amount; }), false);
});

test('partial payments, a later payment, and a refund stay on the bill without double counting', function() {
  const bill = B.prepareTemplate({
    id: 'bill_rent', name: 'Shop rent', category: 'Rent & storage', amount: 1000,
    recurrence: 'monthly', dueDay: 3, type: 'fixed'
  }).bill;
  const first = B.buildPayment({ billId: 'bill_rent', month: '2026-11', amount: 1000 }, 400, '2026-11-03', 'manager');
  let rows = B.instancesForMonth([bill], [first], '2026-11', TODAY);
  assert.equal(rows[0].status, 'partial');
  assert.equal(rows[0].remaining, 600);
  assert.equal(rows[0].paid, false);
  const second = Object.assign({}, first, { id: 'pay_bill_rent_2026-11_b', amountPaid: 600, paidAt: '2026-11-10' });
  rows = B.instancesForMonth([bill], [first, second], '2026-11', TODAY);
  assert.equal(rows[0].status, 'paid');
  assert.equal(rows[0].remaining, 0);
  const refund = B.normalizeTransaction({
    sourceId: 'rent-refund', accountId: 'chase-0714', amount: 100, direction: 'in', kind: 'refund',
    purchaseDate: '2026-11-12', effectiveDate: '2026-11-12', merchant: 'Sample rent refund',
    confidence: 'manual', confirmed: true, target: 'bill', billId: 'bill_rent'
  }).tx;
  rows = B.instancesForMonth([bill], [first, second], '2026-11', TODAY, [refund]);
  assert.equal(rows[0].status, 'partial');
  assert.equal(rows[0].remaining, 100);
  const linked = Object.assign({}, second, { sourceId: 'rent-refund' });
  rows = B.instancesForMonth([bill], [first, linked], '2026-11', TODAY, [refund]);
  assert.equal(rows[0].remaining, 0);
});

test('purchase date and bank effective date stay distinct, and a card payment is not a second expense', function() {
  const budget = B.prepareTemplate({
    id: 'bill_fuel_card', name: 'Sample fuel card', category: 'Fuel', amount: 400,
    recurrence: 'monthly', dueDay: 30, type: 'fixed', notes: 'Paid off weekly; owner estimate. Enter actual. SAMPLE.'
  }).bill;
  budget.funding = 'card';
  budget.fundingAccountId = 'capone-9618';
  const purchase = B.normalizeTransaction({
    sourceId: 'late-post', accountId: 'capone-9618', amount: 50, direction: 'out', kind: 'card_purchase',
    purchaseDate: '2026-11-28', effectiveDate: '2026-12-02', status: 'posted', merchant: 'Sample Late Post',
    confidence: 'manual', confirmed: true, target: 'budget', budgetId: 'bill_fuel_card', category: 'Fuel'
  }).tx;
  const settlement = B.normalizeTransaction({
    sourceId: 'dec-pay', accountId: 'capone-9618', amount: 50, direction: 'in', kind: 'card_payment',
    purchaseDate: '2026-12-02', effectiveDate: '2026-12-02', status: 'posted', merchant: 'Sample card payment'
  }).tx;
  const accounts = [{ id: 'capone-9618', institution: 'Capital One', mask: '9618', kind: 'credit', name: 'Capital One ···9618', freshness: { importedAt: '2026-12-05T12:00:00.000Z', throughDate: '2026-12-05', source: 'diamond-ops-finance' } }];
  const november = B.monthPicture({ today: '2026-12-05', month: '2026-11', bills: [budget], payments: [], transactions: [purchase, settlement], accounts: accounts, balances: {} });
  const december = B.monthPicture({ today: '2026-12-05', month: '2026-12', bills: [budget], payments: [], transactions: [purchase, settlement], accounts: accounts, balances: {} });
  assert.equal(november.budgets[0].actual.amount, 50);
  assert.equal(december.budgets[0].actual.amount, 0);
  const novLiability = november.forecast.lines.find(function(l) { return l.id.indexOf('card-liability:') === 0; });
  assert.equal(novLiability.amount, 0);
  assert.equal(november.forecast.lines.some(function(l) { return l.id.indexOf('card-remaining:') === 0 && l.amount === 350; }), true);
});

test('a high-confidence suggestion is not a confirmed expense', function() {
  const budget = B.prepareTemplate({
    id: 'bill_fuel_debit', name: 'Sample fuel debit', category: 'Fuel', amount: 100,
    recurrence: 'monthly', dueDay: 30, type: 'fixed', notes: 'SAMPLE May-Sep average. Enter actual. Paid directly (debit).'
  }).bill;
  budget.funding = 'bank';
  budget.fundingAccountId = 'boa-1003';
  const suggested = B.normalizeTransaction({
    sourceId: 'guess', accountId: 'boa-1003', amount: 999, direction: 'out', kind: 'bank_debit',
    purchaseDate: '2026-11-04', effectiveDate: '2026-11-04', status: 'posted', merchant: 'Sample Guess',
    confidence: 'high', confirmed: true, target: 'budget', budgetId: 'bill_fuel_debit', category: 'Fuel'
  });
  assert.equal(suggested.tx.assignment.confirmed, false);
  assert.equal(suggested.tx.assignment.confidence, 'none');
  assert.ok(suggested.tx.suggestion);
  const picture = B.monthPicture({
    today: TODAY, month: '2026-11', bills: [budget], payments: [], transactions: [suggested.tx],
    accounts: [{ id: 'boa-1003', mask: '1003', kind: 'bank', name: 'Bank of America ···1003', freshness: { importedAt: '2026-11-13T15:04:00.000Z', throughDate: '2026-11-12', source: 'diamond-ops-finance' } }],
    balances: { boa1003: { amount: 100, asOf: '2026-11-12', source: 'manual' }, chase0714: { amount: 100, asOf: '2026-11-12', source: 'manual' } }
  });
  assert.equal(picture.budgets[0].actual.amount, 0);
  assert.notEqual(picture.budgets[0].actual.amount, 999);
  assert.equal(picture.unmatched.length, 1);
});

test('import upsert drops duplicates and superseded pending rows, and refuses secrets', function() {
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'data', 'finance-import.sample.json'), 'utf8'));
  assert.equal(raw.live, false);
  const prepared = B.prepareImport(raw);
  assert.equal(prepared.ok, true, prepared.errors.join('; '));
  assert.equal(prepared.meta.live, false);
  assert.equal(prepared.report.received, 10);
  assert.equal(prepared.report.duplicatesCollapsed, 1);
  assert.equal(prepared.report.supersededPending, 1);
  assert.equal(prepared.report.unique, 8);
  assert.equal(prepared.report.buckets.expense, 280);
  assert.equal(prepared.report.buckets.refund, 20);
  assert.equal(prepared.report.buckets.settlement, 160);
  assert.equal(prepared.report.buckets.transfer, 500);
  assert.equal(prepared.report.buckets.unmatched, 25);
  assert.equal(prepared.transactions.some(function(tx) { return tx.sourceId === 'sample-pending-old'; }), false);
  assert.equal(prepared.transactions.some(function(tx) { return tx.amount === 99; }), false);
  const secret = B.prepareImport({ accounts: [], transactions: [{ sourceId: 'x', amount: 1, purchaseDate: '2026-11-01', password: 'nope' }] });
  assert.equal(secret.ok, false);
  assert.match(secret.errors.join(' '), /password/);
});

test('migration dry-run keeps card minimums and does not classify from enter-actual alone', function() {
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'data', 'bills-migration.sample.json'), 'utf8'));
  const plan = B.migrationPlan(raw.bills, '2026-11-19T15:00:00.000Z');
  function row(id) { return plan.find(function(r) { return r.id === id; }); }
  ['m_gas', 'm_supplies', 'm_dump', 'm_rental', 'm_fuel_debit', 'm_depot'].forEach(function(id) {
    assert.equal(row(id).action, 'reclassify_budget', id);
    assert.equal(row(id).proposed.kind, 'budget');
    assert.equal(row(id).proposed.classification.original.id, id);
    assert.equal(row(id).proposed.classification.original.notes, row(id).proposed.notes);
    assert.equal(row(id).proposed.active, true);
  });
  assert.equal(row('m_min').action, 'keep_bill');
  assert.equal(row('m_min').dueIsEstimate, true);
  assert.equal(row('m_min').proposed, null);
  assert.equal(row('m_rent').action, 'keep_bill');
  assert.equal(row('m_seeded').action, 'keep_bill');
  assert.equal(row('m_enter_only').action, 'needs_review');
  assert.equal(row('m_loan').action, 'needs_review');
  assert.equal(row('m_ins').action, 'needs_review');
  assert.equal(row('m_fee').action, 'needs_review');
  assert.match(row('m_enter_only').reason, /enter actual/i);
  const dry = spawnSync(process.execPath, ['scripts/migrate-bill-budgets.mjs', 'data/bills-migration.sample.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Migration dry run/);
  assert.match(dry.stdout, /Reclassify as running budget: 6/);
  assert.match(dry.stdout, /Keep as fixed bill: 3/);
  assert.match(dry.stdout, /Needs manual review: 4/);
  assert.match(dry.stdout, /KEEP m_min/);
  assert.match(dry.stdout, /REVIEW m_enter_only/);
  assert.match(dry.stdout, /Nothing was written/);
  const refused = spawnSync(process.execPath, ['scripts/migrate-bill-budgets.mjs', '--write', 'data/bills-migration.sample.json'], {
    cwd: root, encoding: 'utf8', env: Object.assign({}, process.env, { FIRESTORE_EMULATOR_HOST: '' })
  });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /Refusing to write/);
  const prod = spawnSync(process.execPath, ['scripts/migrate-bill-budgets.mjs', '--write'], {
    cwd: root, encoding: 'utf8', env: Object.assign({}, process.env, { FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' })
  });
  assert.equal(prod.status, 2);
  assert.match(prod.stderr, /production/);
});

test('finance import dry-run prints reconciliation and refuses production', function() {
  const dry = spawnSync(process.execPath, ['scripts/import-finance.mjs', 'data/finance-import.sample.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Dry run only/);
  assert.match(dry.stdout, /Live synchronization: no/);
  assert.match(dry.stdout, /Duplicates collapsed: 1/);
  assert.match(dry.stdout, /Pending superseded: 1/);
  assert.match(dry.stdout, /Card settlements: \$160/);
  assert.match(dry.stdout, /Transfers: \$500/);
  assert.match(dry.stdout, /not a live bank connection/i);
  const refused = spawnSync(process.execPath, ['scripts/import-finance.mjs', '--write', 'data/finance-import.sample.json'], {
    cwd: root, encoding: 'utf8', env: Object.assign({}, process.env, { FIRESTORE_EMULATOR_HOST: '' })
  });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /Refusing to write/);
  const prod = spawnSync(process.execPath, ['scripts/import-finance.mjs', '--write'], {
    cwd: root, encoding: 'utf8', env: Object.assign({}, process.env, { FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' })
  });
  assert.equal(prod.status, 2);
  assert.match(prod.stderr, /production/);
});
