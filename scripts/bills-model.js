// Bills & Expenses — pure month math. No Firebase, no DOM.
// Loaded by index.html as a classic script (window.Bills) and by the
// seed script / tests via require. Amounts are never invented here:
// a missing balance stays null so the screen can show an em dash.
//
// Fixed bills (rent, loans, insurance, card minimums, payroll) keep a due
// date and payment matching. Running expense budgets (monthly fuel,
// supplies, dump fees, and similar estimates) are not unpaid bills.
// Card purchases are expenses. A bank payment to a card is a settlement,
// not a second expense. Transfers are neither income nor expense.
// See docs/finance-import.md for the accounting assumptions.
(function (root) {
  var CATEGORIES = [
    'Payroll',
    'Vehicles & equipment',
    'Loans',
    'Rent & storage',
    'Insurance',
    'Fuel',
    'Services/software/phone',
    'Crew operating',
    'Card minimums/Affirm',
    'Personal'
  ];
  var CATEGORY_COLORS = {
    'Payroll': '#3fb950',
    'Vehicles & equipment': '#58a6ff',
    'Loans': '#f0883e',
    'Rent & storage': '#c084fc',
    'Insurance': '#39d353',
    'Fuel': '#e3b341',
    'Services/software/phone': '#f778ba',
    'Crew operating': '#a3e635',
    'Card minimums/Affirm': '#f85149',
    'Personal': '#8b949e'
  };
  var STALE_DAYS = 7;
  var STATUS_RANK = { overdue: 0, partial: 0, due_soon: 1, upcoming: 2, paid: 3 };
  var OPERATING_CATEGORIES = ['Fuel', 'Crew operating', 'Vehicles & equipment'];
  var SECRET_KEYS = { accountnumber: 1, routing: 1, routingnumber: 1, password: 1, token: 1, accesstoken: 1, secret: 1, ssn: 1, credential: 1, credentials: 1, cookie: 1 };

  function cents(n) {
    var x = Number(n);
    if (!isFinite(x)) return 0;
    return Math.round(x * 100) / 100;
  }

  function todayISO(now) {
    var d = now instanceof Date ? now : new Date();
    try { return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); }
    catch (e) { return d.toISOString().slice(0, 10); }
  }

  function isISODate(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  function isMonthKey(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}$/.test(s);
  }

  function monthKeyFromDate(iso) {
    return isISODate(iso) ? iso.slice(0, 7) : '';
  }

  function monthKeyOf(now) {
    return monthKeyFromDate(todayISO(now));
  }

  function addMonths(ym, delta) {
    if (!isMonthKey(ym)) return ym;
    var y = parseInt(ym.slice(0, 4), 10);
    var m = parseInt(ym.slice(5, 7), 10) - 1;
    var dt = new Date(Date.UTC(y, m + (delta || 0), 1));
    var mm = String(dt.getUTCMonth() + 1);
    if (mm.length < 2) mm = '0' + mm;
    return dt.getUTCFullYear() + '-' + mm;
  }

  function addDays(iso, days) {
    if (!isISODate(iso)) return iso;
    var y = parseInt(iso.slice(0, 4), 10);
    var m = parseInt(iso.slice(5, 7), 10) - 1;
    var d = parseInt(iso.slice(8, 10), 10);
    var dt = new Date(Date.UTC(y, m, d + (days || 0)));
    var mm = String(dt.getUTCMonth() + 1);
    var dd = String(dt.getUTCDate());
    if (mm.length < 2) mm = '0' + mm;
    if (dd.length < 2) dd = '0' + dd;
    return dt.getUTCFullYear() + '-' + mm + '-' + dd;
  }

  function daysBetween(fromISO, toISO) {
    if (!isISODate(fromISO) || !isISODate(toISO)) return null;
    var a = Date.UTC(+fromISO.slice(0, 4), +fromISO.slice(5, 7) - 1, +fromISO.slice(8, 10));
    var b = Date.UTC(+toISO.slice(0, 4), +toISO.slice(5, 7) - 1, +toISO.slice(8, 10));
    return Math.round((b - a) / 86400000);
  }

  function lastDayOfMonth(ym) {
    if (!isMonthKey(ym)) return 28;
    var y = parseInt(ym.slice(0, 4), 10);
    var m = parseInt(ym.slice(5, 7), 10);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  function prettyDate(iso) {
    if (!isISODate(iso)) return '';
    var dt = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), 12));
    try {
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    } catch (e) { return iso; }
  }

  function monthLabel(ym) {
    if (!isMonthKey(ym)) return ym || '';
    var dt = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1, 12));
    try {
      return dt.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    } catch (e2) { return ym; }
  }

  function money(n) {
    if (n == null || n === '' || !isFinite(Number(n))) return '—';
    var neg = Number(n) < 0;
    var abs = Math.abs(cents(n));
    var showCents = Math.round(abs * 100) % 100 !== 0;
    var s = abs.toLocaleString('en-US', { minimumFractionDigits: showCents ? 2 : 0, maximumFractionDigits: 2 });
    return (neg ? '-$' : '$') + s;
  }

  function needsAmountPrompt(bill) {
    if (!bill) return false;
    return bill.type === 'credit_card' || bill.variableAmount === true;
  }

  function dueDateFor(template, ym) {
    if (!template || !isMonthKey(ym)) return '';
    if (template.recurrence === 'once') {
      return monthKeyFromDate(template.dueDate) === ym ? template.dueDate : '';
    }
    var day = parseInt(template.dueDay, 10);
    if (!(day >= 1)) return '';
    var last = lastDayOfMonth(ym);
    if (day > last) day = last;
    var dd = String(day);
    if (dd.length < 2) dd = '0' + dd;
    return ym + '-' + dd;
  }

  function paymentFor(payments, billId, ym) {
    var found = null;
    (payments || []).forEach(function (p) {
      if (!p || p.billId !== billId || p.month !== ym || p.status !== 'paid') return;
      found = p;
    });
    return found;
  }

  function statusOf(dueDate, paid, today) {
    if (paid) return 'paid';
    if (!isISODate(dueDate) || !isISODate(today)) return 'upcoming';
    if (dueDate < today) return 'overdue';
    if (dueDate <= addDays(today, 7)) return 'due_soon';
    return 'upcoming';
  }

  function paymentsFor(payments, billId, ym) {
    var list = [];
    (payments || []).forEach(function (p) {
      if (!p || p.billId !== billId || p.month !== ym || p.status !== 'paid') return;
      list.push(p);
    });
    return list;
  }

  function sumPayments(list) {
    var n = 0;
    (list || []).forEach(function (p) { n = cents(n + (Number(p.amountPaid) || 0)); });
    return n;
  }

  // Fully paid when the recorded payments cover the obligation.
  // A smaller positive payment is partial — the bill stays open for the rest.
  function billStatus(dueDate, paidSum, expected, today) {
    var exp = Number(expected) || 0;
    var paid = Number(paidSum) || 0;
    if (exp > 0 && paid + 0.009 >= exp) return 'paid';
    if (paid > 0.009) return 'partial';
    return statusOf(dueDate, false, today);
  }

  function instancesForMonth(templates, payments, ym, today, transactions) {
    var list = [];
    var txByBill = billTransactions(transactions);
    (templates || []).forEach(function (t) {
      if (!t || !t.id) return;
      var cls = classifyBill(t);
      if (cls.role === 'budget') return;
      var pays = paymentsFor(payments, t.id, ym);
      if (t.active === false && !pays.length) return;
      var due = dueDateFor(t, ym);
      if (!due && t.recurrence === 'once') return;
      if (!due && t.recurrence !== 'monthly') return;
      if (!due) return;
      var expected = t.amount;
      if (pays.length && pays[0].expectedAmount != null && pays[0].expectedAmount !== '' && isFinite(Number(pays[0].expectedAmount))) {
        expected = Number(pays[0].expectedAmount);
      }
      expected = cents(expected);
      var paySum = netBillPaid(pays, txByBill[t.id] || [], ym);
      var st = billStatus(due, paySum, expected, today);
      var fully = st === 'paid';
      var late = (!fully && isISODate(due) && due < today) ? daysBetween(due, today) : 0;
      var last = pays.length ? pays[pays.length - 1] : null;
      list.push({
        billId: t.id,
        name: t.name || 'Bill',
        category: t.category || '',
        notes: t.notes || '',
        type: t.type || 'fixed',
        variableAmount: needsAmountPrompt(t),
        recurrence: t.recurrence || 'monthly',
        amount: expected,
        dueDate: due,
        month: ym,
        status: st,
        paid: fully,
        partial: st === 'partial',
        amountPaid: paySum > 0 ? paySum : null,
        remaining: cents(Math.max(0, expected - paySum)),
        paidAt: last ? (last.paidAt || '') : '',
        paidBy: last ? (last.paidBy || '') : '',
        paymentId: last ? (last.id || paymentId(t.id, ym)) : paymentId(t.id, ym),
        paymentCount: pays.length,
        daysOverdue: late || 0,
        estimateAmount: !!cls.amountIsEstimate,
        estimateDue: !!cls.dueIsEstimate,
        review: !!cls.review,
        reviewReason: cls.review ? cls.reason : '',
        settlementAccountId: t.settlementAccountId ? String(t.settlementAccountId) : ''
      });
    });
    return list;
  }

  function sortInstances(list) {
    return (list || []).slice().sort(function (a, b) {
      var d = (STATUS_RANK[a.status] == null ? 9 : STATUS_RANK[a.status]) - (STATUS_RANK[b.status] == null ? 9 : STATUS_RANK[b.status]);
      if (d) return d;
      if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  function summarize(instances) {
    var budget = 0, paid = 0, unpaid = 0, overdue = 0, overdueCount = 0, dueSoon = 0, dueSoonCount = 0;
    (instances || []).forEach(function (inst) {
      budget = cents(budget + (Number(inst.amount) || 0));
      var rem = inst.remaining != null ? Number(inst.remaining) : (Number(inst.amount) || 0);
      if (inst.status === 'paid') {
        paid = cents(paid + (Number(inst.amountPaid) || 0));
      } else {
        unpaid = cents(unpaid + rem);
        if (inst.status === 'partial') paid = cents(paid + (Number(inst.amountPaid) || 0));
        var past = inst.status === 'overdue' || (inst.status === 'partial' && (inst.daysOverdue || 0) > 0);
        if (past) {
          overdue = cents(overdue + rem);
          overdueCount++;
        } else if (inst.status === 'due_soon') {
          dueSoon = cents(dueSoon + rem);
          dueSoonCount++;
        }
      }
    });
    return {
      budget: budget,
      paid: paid,
      unpaid: unpaid,
      overdue: overdue,
      overdueCount: overdueCount,
      dueSoon: dueSoon,
      dueSoonCount: dueSoonCount,
      count: (instances || []).length
    };
  }

  function byCategory(instances) {
    var map = {};
    CATEGORIES.forEach(function (c) { map[c] = 0; });
    (instances || []).forEach(function (inst) {
      var c = inst.category || 'Other';
      if (map[c] == null) map[c] = 0;
      map[c] = cents(map[c] + (Number(inst.amount) || 0));
    });
    return map;
  }

  function finiteOrNull(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function balanceView(entry, today) {
    var amount = entry ? finiteOrNull(entry.amount) : null;
    var asOf = entry && entry.asOf ? String(entry.asOf) : '';
    if (amount == null) {
      return { amount: null, asOf: asOf, badge: 'not_connected' };
    }
    var source = entry && entry.source ? String(entry.source) : '';
    var age = isISODate(asOf) ? daysBetween(asOf, today) : null;
    var stale = !isISODate(asOf) || age == null || age > STALE_DAYS || age < 0;
    var freshConnection = source === 'connected' && !stale;
    return { amount: cents(amount), asOf: asOf, badge: freshConnection ? '' : 'unverified' };
  }

  function cashAfter(chaseAmount, boaAmount, unpaid) {
    if (chaseAmount == null || boaAmount == null) return null;
    if (!isFinite(Number(chaseAmount)) || !isFinite(Number(boaAmount))) return null;
    return cents(Number(chaseAmount) + Number(boaAmount) - (Number(unpaid) || 0));
  }

  function invoiceSummary(invoices, today, meta) {
    var open = (invoices || []).filter(function (inv) {
      return inv && inv.status !== 'paid';
    });
    var asOf = meta && meta.asOf ? String(meta.asOf) : '';
    if (!open.length) {
      return { total: null, count: null, overdue: null, asOf: asOf, badge: 'not_connected', empty: true };
    }
    var total = 0, overdue = 0;
    open.forEach(function (inv) {
      total = cents(total + (Number(inv.amount) || 0));
      if (isISODate(inv.dueDate) && inv.dueDate < today) overdue++;
    });
    var source = meta && meta.source ? String(meta.source) : '';
    var connected = meta && meta.connected === true;
    var age = isISODate(asOf) ? daysBetween(asOf, today) : null;
    var stale = !isISODate(asOf) || age == null || age > STALE_DAYS || age < 0;
    var badge = (source === 'connected' && connected && !stale) ? '' : 'unverified';
    return { total: total, count: open.length, overdue: overdue, asOf: asOf, badge: badge, empty: false };
  }

  function invoiceDaysOverdue(inv, today) {
    if (!inv || inv.status === 'paid' || !isISODate(inv.dueDate) || !isISODate(today)) return 0;
    if (inv.dueDate >= today) return 0;
    return daysBetween(inv.dueDate, today) || 0;
  }

  function paymentId(billId, ym) {
    return 'pay_' + String(billId || '') + '_' + String(ym || '');
  }

  function buildPayment(instance, amountPaid, paidAt, paidBy) {
    var amount = finiteOrNull(amountPaid);
    if (!instance || amount == null || amount < 0) return null;
    if (!isISODate(paidAt)) return null;
    return {
      id: paymentId(instance.billId, instance.month),
      billId: instance.billId,
      month: instance.month,
      amountPaid: cents(amount),
      paidAt: paidAt,
      paidBy: paidBy || '',
      status: 'paid',
      expectedAmount: cents(instance.amount)
    };
  }

  function prepareTemplate(input) {
    var src = input || {};
    var name = String(src.name || '').trim();
    if (!name) return { ok: false, error: 'Name is required' };
    if (name.length > 200) return { ok: false, error: 'Name is too long' };
    var category = String(src.category || '');
    if (CATEGORIES.indexOf(category) < 0) return { ok: false, error: 'Pick a category' };
    var amount = finiteOrNull(src.amount);
    if (amount == null || amount < 0 || amount > 100000000) return { ok: false, error: 'Enter an amount' };
    var recurrence = src.recurrence === 'once' ? 'once' : (src.recurrence === 'monthly' ? 'monthly' : '');
    if (!recurrence) return { ok: false, error: 'Pick monthly or one-time' };
    var type = src.type === 'credit_card' ? 'credit_card' : 'fixed';
    var variableAmount = type === 'credit_card' || src.variableAmount === true;
    var dueDay = null;
    var dueDate = null;
    if (recurrence === 'monthly') {
      dueDay = parseInt(src.dueDay, 10);
      if (!(dueDay >= 1 && dueDay <= 31)) return { ok: false, error: 'Due day must be 1–31' };
    } else {
      dueDate = String(src.dueDate || '');
      if (!isISODate(dueDate)) return { ok: false, error: 'Pick a due date' };
    }
    var notes = String(src.notes == null ? '' : src.notes);
    if (notes.length > 2000) return { ok: false, error: 'Notes are too long' };
    var nowISO = new Date().toISOString();
    return {
      ok: true,
      bill: {
        id: src.id ? String(src.id) : '',
        name: name,
        category: category,
        amount: cents(amount),
        recurrence: recurrence,
        dueDay: dueDay,
        dueDate: dueDate,
        type: type,
        variableAmount: variableAmount,
        notes: notes,
        active: src.active === false ? false : true,
        createdAt: src.createdAt || nowISO,
        updatedAt: nowISO,
        updatedBy: src.updatedBy || ''
      }
    };
  }

  function prepareInvoice(input) {
    var src = input || {};
    var customer = String(src.customer || '').trim();
    if (!customer) return { ok: false, error: 'Customer is required' };
    if (customer.length > 200) return { ok: false, error: 'Customer name is too long' };
    var invoiceNumber = String(src.invoiceNumber || '').trim();
    if (!invoiceNumber) return { ok: false, error: 'Invoice number is required' };
    if (invoiceNumber.length > 60) return { ok: false, error: 'Invoice number is too long' };
    var amount = finiteOrNull(src.amount);
    if (amount == null || amount < 0 || amount > 100000000) return { ok: false, error: 'Enter an amount' };
    var dueDate = String(src.dueDate || '');
    if (!isISODate(dueDate)) return { ok: false, error: 'Pick a due date' };
    var status = src.status === 'paid' ? 'paid' : 'open';
    var source = src.source === 'quickbooks' ? 'quickbooks' : 'manual';
    var notes = String(src.notes == null ? '' : src.notes);
    var nowISO = new Date().toISOString();
    return {
      ok: true,
      invoice: {
        id: src.id ? String(src.id) : '',
        customer: customer,
        invoiceNumber: invoiceNumber,
        amount: cents(amount),
        dueDate: dueDate,
        status: status,
        source: source,
        notes: notes,
        createdAt: src.createdAt || nowISO,
        updatedAt: nowISO,
        updatedBy: src.updatedBy || ''
      }
    };
  }

  function emptyBalances(updatedBy) {
    return {
      id: 'balances',
      kind: 'balances',
      chase0714: { amount: null, asOf: null, source: '' },
      boa1003: { amount: null, asOf: null, source: '' },
      quickbooks: { asOf: null, source: '', connected: false },
      updatedAt: new Date().toISOString(),
      updatedBy: updatedBy || ''
    };
  }

  function slotFrom(raw) {
    raw = raw || {};
    return {
      amount: finiteOrNull(raw.amount),
      asOf: raw.asOf ? String(raw.asOf) : null,
      source: raw.source ? String(raw.source) : ''
    };
  }

  function normalizeBalances(raw, updatedBy) {
    var base = emptyBalances(updatedBy);
    var src = raw || {};
    base.chase0714 = slotFrom(src.chase0714);
    base.boa1003 = slotFrom(src.boa1003);
    var qb = src.quickbooks || {};
    base.quickbooks = {
      asOf: qb.asOf ? String(qb.asOf) : null,
      source: qb.source ? String(qb.source) : '',
      connected: qb.connected === true
    };
    if (src.updatedAt) base.updatedAt = String(src.updatedAt);
    if (src.updatedBy) base.updatedBy = String(src.updatedBy);
    else base.updatedBy = updatedBy || '';
    return base;
  }

  function validateImport(data) {
    var errors = [];
    var src = data || {};
    if (src._comment) { /* documentation only */ }
    var balances = normalizeBalances(src.balances || {}, 'import');
    var bills = [];
    (src.bills || []).forEach(function (row, i) {
      var prepared = prepareTemplate(row);
      if (!prepared.ok) { errors.push('bills[' + i + ']: ' + prepared.error); return; }
      var bill = prepared.bill;
      if (!bill.id) bill.id = 'bill_' + (i + 1);
      bills.push(bill);
    });
    var payments = [];
    (src.payments || []).forEach(function (row, i) {
      if (!row || !row.billId || !isMonthKey(row.month)) {
        errors.push('payments[' + i + ']: billId and month (YYYY-MM) are required');
        return;
      }
      var amount = finiteOrNull(row.amountPaid);
      if (amount == null || amount < 0) { errors.push('payments[' + i + ']: amountPaid is required'); return; }
      if (!isISODate(row.paidAt)) { errors.push('payments[' + i + ']: paidAt must be YYYY-MM-DD'); return; }
      payments.push({
        id: row.id || paymentId(row.billId, row.month),
        billId: String(row.billId),
        month: row.month,
        amountPaid: cents(amount),
        paidAt: row.paidAt,
        paidBy: row.paidBy ? String(row.paidBy) : '',
        status: 'paid',
        expectedAmount: finiteOrNull(row.expectedAmount) == null ? cents(amount) : cents(row.expectedAmount)
      });
    });
    var invoices = [];
    (src.invoices || []).forEach(function (row, i) {
      var prepared = prepareInvoice(row);
      if (!prepared.ok) { errors.push('invoices[' + i + ']: ' + prepared.error); return; }
      var inv = prepared.invoice;
      if (!inv.id) inv.id = 'inv_' + (i + 1);
      invoices.push(inv);
    });
    return { ok: errors.length === 0, errors: errors, balances: balances, bills: bills, payments: payments, invoices: invoices };
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj == null ? null : obj));
  }

  function notesOf(bill) {
    return String(bill && bill.notes || '');
  }

  function isCardMinimum(bill) {
    if (!bill) return false;
    if (bill.category === 'Card minimums/Affirm') return true;
    var name = String(bill.name || '');
    if (/affirm/i.test(name) && (bill.type === 'credit_card' || /minimum/i.test(name + ' ' + notesOf(bill)))) return true;
    if (bill.type === 'credit_card' && /minimum/i.test(name)) return true;
    return false;
  }

  function budgetSignal(notes) {
    var monthlyEstimate = /monthly estimate/i.test(notes);
    var ownerEstimate = /owner estimate/i.test(notes);
    var historicalAverage = /may[-– ]sep average|historical average|monthly average|\baverage\b/i.test(notes);
    var enterActual = /enter actual/i.test(notes);
    var paidWeekly = /paid off weekly/i.test(notes);
    if (monthlyEstimate && enterActual) return { code: 'monthly_estimate', detail: 'Notes say this is a monthly estimate and to enter the actual.' };
    if (ownerEstimate && enterActual && paidWeekly) return { code: 'weekly_card_spend', detail: 'Notes say owner estimate, enter the actual, and paid off weekly.' };
    if (historicalAverage && enterActual && !/minimum/i.test(notes)) return { code: 'historical_average', detail: 'Notes give a historical average and say to enter the actual.' };
    return null;
  }

  function protectedBillName(name) {
    return /\b(minimum|affirm|payroll|rent|insurance|loan|storage|wage)\b/i.test(String(name || ''));
  }

  // Classify a must-pay doc. Card minimums stay bills even when the notes
  // say "estimated minimums" or "enter actual". "Enter actual" alone is
  // not enough to call something a budget. Ambiguous docs stay bills and
  // are flagged for a person to review.
  function classifyBill(bill) {
    var src = bill || {};
    var notes = notesOf(src);
    var dueIsEstimate = /due day unknown|placeholder/i.test(notes);
    var amountIsEstimate = /estimat|average|enter actual/i.test(notes);
    if (src.kind === 'budget') {
      return { role: 'budget', confidence: 'stored', reason: 'Already stored as a running expense budget.', review: false, signal: 'stored', dueIsEstimate: false, amountIsEstimate: true };
    }
    if (src.kind === 'bill') {
      return { role: 'bill', confidence: 'stored', reason: 'Already stored as a fixed bill.', review: false, signal: '', dueIsEstimate: dueIsEstimate, amountIsEstimate: amountIsEstimate };
    }
    if (isCardMinimum(src)) {
      return {
        role: 'bill',
        confidence: 'clear',
        reason: 'Card minimums and Affirm stay bills. Estimated minimums are not expense budgets.',
        review: false,
        signal: '',
        dueIsEstimate: dueIsEstimate,
        amountIsEstimate: /estimat|enter actual|placeholder/i.test(notes)
      };
    }
    var signal = budgetSignal(notes);
    var operating = OPERATING_CATEGORIES.indexOf(src.category) >= 0;
    if (signal && operating && !protectedBillName(src.name)) {
      return { role: 'budget', confidence: 'clear', reason: signal.detail, review: false, signal: signal.code, dueIsEstimate: false, amountIsEstimate: true };
    }
    var reasons = [];
    if (signal && !operating) reasons.push('Notes look like a monthly estimate, but the category is not a running operating expense.');
    if (signal && protectedBillName(src.name)) reasons.push('Notes look like an estimate, but the name is a fixed obligation.');
    if (/purpose unconfirmed/i.test(notes)) reasons.push('Purpose is unconfirmed.');
    if (/when balance|only if the balance|only if balance/i.test(notes)) reasons.push('This is a conditional fee, not a spending budget.');
    if (/enter actual/i.test(notes) && !signal) reasons.push('Notes say enter actual without a monthly estimate, owner estimate, or historical average.');
    if (/estimated minimums/i.test(notes)) reasons.push('Estimated minimums is not an expense-budget signal outside card minimums.');
    if (dueIsEstimate) reasons.push('The due day is a placeholder.');
    if (reasons.length) {
      return { role: 'bill', confidence: 'ambiguous', reason: reasons.join(' '), review: true, signal: '', dueIsEstimate: dueIsEstimate, amountIsEstimate: amountIsEstimate || /enter actual|estimat/i.test(notes) };
    }
    return { role: 'bill', confidence: 'clear', reason: 'No clear running-budget signal. Kept as a fixed bill.', review: false, signal: '', dueIsEstimate: false, amountIsEstimate: false };
  }

  function inferFunding(bill) {
    var explicit = bill && bill.funding;
    if (explicit === 'card' || explicit === 'bank' || explicit === 'unknown') return explicit;
    var text = notesOf(bill) + ' ' + String(bill && bill.name || '');
    var bankish = /debit|paid directly|from checking|from the bank|from chase/i.test(text);
    var cardish = /paid off weekly|capital one|credit card|\bcard\b/i.test(text);
    if (bankish && !cardish) return 'bank';
    if (cardish && !bankish) return 'card';
    return 'unknown';
  }

  function migrationPlan(bills, nowISO) {
    var at = nowISO || new Date().toISOString();
    return (bills || []).filter(function (b) { return b && b.id; }).map(function (bill) {
      var cls = classifyBill(bill);
      var action = 'keep_bill';
      if (bill.kind === 'budget') action = 'already_budget';
      else if (cls.review) action = 'needs_review';
      else if (cls.role === 'budget' && cls.confidence === 'clear') action = 'reclassify_budget';
      var proposed = null;
      if (action === 'reclassify_budget') {
        proposed = clone(bill);
        proposed.kind = 'budget';
        proposed.funding = inferFunding(bill);
        proposed.active = bill.active === false ? false : true;
        proposed.classification = {
          action: 'reclassify_budget',
          at: at,
          signal: cls.signal || '',
          reason: cls.reason,
          original: clone(bill)
        };
      }
      return {
        action: action,
        id: String(bill.id),
        name: bill.name || '',
        category: bill.category || '',
        amount: finiteOrNull(bill.amount),
        reason: cls.reason,
        signal: cls.signal || '',
        dueIsEstimate: !!cls.dueIsEstimate,
        amountIsEstimate: !!cls.amountIsEstimate,
        review: !!cls.review,
        funding: action === 'reclassify_budget' ? proposed.funding : inferFunding(bill),
        proposed: proposed
      };
    });
  }

  function hasSecretKey(value, path) {
    if (!value || typeof value !== 'object') return '';
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (SECRET_KEYS[String(key).toLowerCase()]) return (path ? path + '.' : '') + key;
      if (value[key] && typeof value[key] === 'object') {
        var nested = hasSecretKey(value[key], (path ? path + '.' : '') + key);
        if (nested) return nested;
      }
    }
    return '';
  }

  function transactionId(source, sourceId) {
    var s = String(source || 'manual').replace(/[^a-zA-Z0-9]+/g, '');
    var id = String(sourceId || '').replace(/[^a-zA-Z0-9_-]+/g, '');
    return 'tx_' + s + '_' + id;
  }

  function normalizeKind(raw) {
    var k = String(raw || '').toLowerCase().replace(/[\s-]+/g, '_');
    if (k === 'purchase' || k === 'card' || k === 'sale' || k === 'card_purchase') return 'card_purchase';
    if (k === 'payment' || k === 'autopay' || k === 'card_payment') return 'card_payment';
    if (k === 'debit' || k === 'bank_debit' || k === 'withdrawal') return 'bank_debit';
    if (k === 'credit' || k === 'bank_credit' || k === 'deposit') return 'bank_credit';
    if (k === 'transfer') return 'transfer';
    if (k === 'refund' || k === 'reversal') return 'refund';
    if (k === 'fee') return 'fee';
    return 'unknown';
  }

  function normalizeTransaction(raw) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'Transaction must be an object' };
    var secret = hasSecretKey(raw, '');
    if (secret) return { ok: false, error: 'Refusing field ' + secret + '. Account credentials do not belong in an import.' };
    var source = String(raw.source || 'diamond-ops-finance');
    var sourceId = String(raw.sourceId || raw.source_id || raw.id || '').trim();
    if (!sourceId) return { ok: false, error: 'sourceId is required' };
    if (sourceId.length > 160) return { ok: false, error: 'sourceId is too long' };
    var amount = finiteOrNull(raw.amount);
    if (amount == null || amount === 0) return { ok: false, error: 'amount is required' };
    var direction = String(raw.direction || '').toLowerCase();
    if (amount < 0) {
      direction = direction === 'out' ? 'in' : 'in';
      if (String(raw.direction || '').toLowerCase() === 'in') direction = 'out';
      amount = Math.abs(amount);
    }
    if (direction === 'credit' || direction === 'inflow') direction = 'in';
    if (direction === 'debit' || direction === 'outflow') direction = 'out';
    if (direction !== 'in' && direction !== 'out') direction = 'out';
    var purchaseDate = String(raw.purchaseDate || raw.purchase_date || raw.date || '');
    var effectiveDate = String(raw.effectiveDate || raw.effective_date || raw.postedDate || raw.posted_date || raw.bankDate || purchaseDate || '');
    if (purchaseDate && !isISODate(purchaseDate)) return { ok: false, error: 'purchaseDate must be YYYY-MM-DD' };
    if (effectiveDate && !isISODate(effectiveDate)) return { ok: false, error: 'effectiveDate must be YYYY-MM-DD' };
    if (!purchaseDate && !effectiveDate) return { ok: false, error: 'purchaseDate or effectiveDate is required' };
    if (!purchaseDate) purchaseDate = effectiveDate;
    if (!effectiveDate) effectiveDate = purchaseDate;
    var status = String(raw.status || 'posted').toLowerCase() === 'pending' ? 'pending' : 'posted';
    var confidence = String(raw.confidence || (raw.assignment && raw.assignment.confidence) || 'none').toLowerCase();
    if (['none', 'low', 'high', 'manual'].indexOf(confidence) < 0) confidence = 'none';
    var confirmedFlag = raw.confirmed === true || (raw.assignment && raw.assignment.confirmed === true);
    var manual = confidence === 'manual' && confirmedFlag;
    var target = String((raw.assignment && raw.assignment.target) || raw.target || 'unmatched');
    if (['category', 'budget', 'bill', 'personal', 'transfer', 'unmatched'].indexOf(target) < 0) target = 'unmatched';
    var suggestion = null;
    var assignment;
    if (manual && target !== 'unmatched') {
      assignment = {
        target: target,
        category: String((raw.assignment && raw.assignment.category) || raw.category || ''),
        budgetId: String((raw.assignment && raw.assignment.budgetId) || raw.budgetId || ''),
        billId: String((raw.assignment && raw.assignment.billId) || raw.billId || ''),
        confidence: 'manual',
        confirmed: true
      };
    } else {
      if (target !== 'unmatched' || confidence === 'low' || confidence === 'high') {
        suggestion = {
          target: target === 'unmatched' ? 'category' : target,
          category: String((raw.assignment && raw.assignment.category) || raw.category || ''),
          budgetId: String((raw.assignment && raw.assignment.budgetId) || raw.budgetId || ''),
          billId: String((raw.assignment && raw.assignment.billId) || raw.billId || ''),
          confidence: confidence === 'manual' ? 'high' : confidence
        };
      }
      assignment = { target: 'unmatched', category: '', budgetId: '', billId: '', confidence: 'none', confirmed: false };
    }
    return {
      ok: true,
      tx: {
        id: transactionId(source, sourceId),
        source: source,
        sourceId: sourceId,
        accountId: String(raw.accountId || raw.account_id || ''),
        counterAccountId: raw.counterAccountId ? String(raw.counterAccountId) : (raw.counter_account_id ? String(raw.counter_account_id) : ''),
        settlementGroup: raw.settlementGroup ? String(raw.settlementGroup) : (raw.settlement_group ? String(raw.settlement_group) : ''),
        amount: cents(amount),
        direction: direction,
        kind: normalizeKind(raw.kind),
        purchaseDate: purchaseDate,
        effectiveDate: effectiveDate,
        status: status,
        supersedes: raw.supersedes ? String(raw.supersedes) : (raw.pendingSourceId ? String(raw.pendingSourceId) : ''),
        merchant: String(raw.merchant || raw.description || '').slice(0, 200),
        memo: String(raw.memo || '').slice(0, 500),
        importedAt: raw.importedAt ? String(raw.importedAt) : '',
        assignment: assignment,
        suggestion: suggestion
      }
    };
  }

  // Last copy of a source id wins, except a later pending row cannot
  // overwrite a posted row. A posted row can name the pending source id
  // it replaces so the pending copy is dropped.
  function reconcileTransactions(list) {
    var byId = {};
    (list || []).forEach(function (raw) {
      var prepared = raw && raw.sourceId && raw.kind && raw.assignment ? { ok: true, tx: raw } : normalizeTransaction(raw);
      if (!prepared.ok) return;
      var tx = prepared.tx;
      var prev = byId[tx.id];
      if (prev && prev.status === 'posted' && tx.status === 'pending') return;
      byId[tx.id] = tx;
    });
    var drop = {};
    Object.keys(byId).forEach(function (id) {
      var tx = byId[id];
      if (tx.supersedes) {
        drop[tx.supersedes] = true;
        drop[transactionId(tx.source, tx.supersedes)] = true;
      }
    });
    return Object.keys(byId).map(function (id) { return byId[id]; }).filter(function (tx) {
      if (tx.superseded) return false;
      if (drop[tx.id] || drop[tx.sourceId]) return false;
      return true;
    });
  }

  function allocationConfirmed(tx) {
    var a = tx && tx.assignment;
    if (!a || a.target === 'unmatched' || !a.target) return false;
    return a.confidence === 'manual' && a.confirmed === true;
  }

  function signedExpense(tx) {
    if (!allocationConfirmed(tx)) return 0;
    if (tx.kind === 'card_payment' || tx.kind === 'transfer') return 0;
    var target = tx.assignment.target;
    if (target === 'personal' || target === 'transfer' || target === 'bill' || target === 'unmatched') return 0;
    if (target !== 'category' && target !== 'budget') return 0;
    var sign = (tx.direction === 'in' || tx.kind === 'refund') ? -1 : 1;
    return cents(sign * (Number(tx.amount) || 0));
  }

  function billTransactions(transactions) {
    var map = {};
    reconcileTransactions(transactions || []).forEach(function (tx) {
      if (!allocationConfirmed(tx) || !tx.assignment || tx.assignment.target !== 'bill' || !tx.assignment.billId) return;
      var id = tx.assignment.billId;
      if (!map[id]) map[id] = [];
      map[id].push(tx);
    });
    return map;
  }

  function netBillPaid(pays, txs, ym) {
    var sum = sumPayments(pays);
    var linked = {};
    (pays || []).forEach(function (p) {
      if (p.transactionId) linked[p.transactionId] = true;
      if (p.sourceId) linked[p.sourceId] = true;
    });
    (txs || []).forEach(function (tx) {
      if (linked[tx.id] || linked[tx.sourceId]) return;
      var when = tx.effectiveDate || tx.purchaseDate;
      if (monthKeyFromDate(when) !== ym) return;
      if (tx.kind === 'card_payment') return;
      if (tx.direction === 'in' || tx.kind === 'refund') sum = cents(sum - tx.amount);
      else sum = cents(sum + tx.amount);
    });
    return sum;
  }

  function accountHasImport(accountId, accounts, transactions) {
    var found = false;
    (accounts || []).forEach(function (a) {
      if (!a || a.id !== accountId) return;
      if (a.freshness && (a.freshness.importedAt || a.freshness.throughDate)) found = true;
    });
    if (found) return true;
    var txs = reconcileTransactions(transactions || []);
    for (var i = 0; i < txs.length; i++) if (txs[i].accountId === accountId) return true;
    return false;
  }

  function txOnOrBefore(tx, today) {
    if (!isISODate(today)) return true;
    var when = tx.kind === 'card_payment' ? (tx.effectiveDate || tx.purchaseDate) : (tx.purchaseDate || tx.effectiveDate);
    if (!isISODate(when)) return false;
    return when <= today;
  }

  function liabilityDelta(tx) {
    if (!tx || tx.kind === 'transfer') return 0;
    if (tx.kind === 'card_payment') return tx.direction === 'in' ? -tx.amount : tx.amount;
    if (tx.kind === 'refund' || tx.direction === 'in') return -tx.amount;
    return tx.amount;
  }

  function latestImportAt(accounts, transactions, meta) {
    var best = meta && meta.importedAt ? String(meta.importedAt) : '';
    (accounts || []).forEach(function (a) {
      var at = a && a.freshness && a.freshness.importedAt;
      if (at && (!best || String(at) > best)) best = String(at);
    });
    (transactions || []).forEach(function (tx) {
      if (tx && tx.importedAt && (!best || String(tx.importedAt) > best)) best = String(tx.importedAt);
    });
    return best;
  }

  function partitionOf(tx) {
    if (tx.kind === 'transfer' || (tx.assignment && tx.assignment.target === 'transfer' && allocationConfirmed(tx))) return 'transfer';
    if (tx.kind === 'card_payment') return 'settlement';
    if (tx.kind === 'refund') return 'refund';
    if (tx.kind === 'bank_credit') return 'inflow';
    if (allocationConfirmed(tx) && tx.assignment.target === 'personal') return 'personal';
    if (allocationConfirmed(tx) && tx.assignment.target === 'bill') return 'bill_payment';
    if (allocationConfirmed(tx) && (tx.assignment.target === 'category' || tx.assignment.target === 'budget')) return 'expense';
    return 'unmatched';
  }

  function summarizeImport(rawList) {
    var errors = [];
    var prepared = [];
    (rawList || []).forEach(function (row, i) {
      var norm = normalizeTransaction(row);
      if (!norm.ok) { errors.push('transactions[' + i + ']: ' + norm.error); return; }
      prepared.push(norm.tx);
    });
    var seen = {};
    var duplicates = 0;
    prepared.forEach(function (tx) {
      if (seen[tx.id]) duplicates++;
      seen[tx.id] = true;
    });
    var reconciled = reconcileTransactions(prepared);
    var superseded = prepared.length - duplicates - reconciled.length;
    if (superseded < 0) superseded = 0;
    var buckets = { expense: 0, settlement: 0, transfer: 0, refund: 0, personal: 0, bill_payment: 0, inflow: 0, unmatched: 0 };
    var counts = { expense: 0, settlement: 0, transfer: 0, refund: 0, personal: 0, bill_payment: 0, inflow: 0, unmatched: 0 };
    var byAccount = {};
    reconciled.forEach(function (tx) {
      var part = partitionOf(tx);
      buckets[part] = cents(buckets[part] + tx.amount);
      counts[part]++;
      if (!byAccount[tx.accountId || '(none)']) {
        byAccount[tx.accountId || '(none)'] = { postedIn: 0, postedOut: 0, pendingIn: 0, pendingOut: 0, count: 0 };
      }
      var slot = byAccount[tx.accountId || '(none)'];
      slot.count++;
      var pending = tx.status === 'pending';
      if (tx.direction === 'in') {
        if (pending) slot.pendingIn = cents(slot.pendingIn + tx.amount);
        else slot.postedIn = cents(slot.postedIn + tx.amount);
      } else if (pending) slot.pendingOut = cents(slot.pendingOut + tx.amount);
      else slot.postedOut = cents(slot.postedOut + tx.amount);
    });
    return {
      ok: errors.length === 0,
      errors: errors,
      received: (rawList || []).length,
      accepted: prepared.length,
      unique: reconciled.length,
      duplicatesCollapsed: duplicates,
      supersededPending: superseded,
      buckets: buckets,
      counts: counts,
      byAccount: byAccount,
      transactions: reconciled
    };
  }

  function prepareImport(data) {
    var src = data || {};
    var secret = hasSecretKey(src, '');
    if (secret) return { ok: false, errors: ['Refusing field ' + secret + '. Do not put bank credentials in the import file.'], accounts: [], transactions: [], meta: {} };
    var report = summarizeImport(src.transactions || []);
    var accounts = [];
    (src.accounts || []).forEach(function (row, i) {
      if (!row || !row.id) { report.errors.push('accounts[' + i + ']: id is required'); return; }
      var kind = row.kind === 'credit' ? 'credit' : (row.kind === 'bank' ? 'bank' : '');
      if (!kind) { report.errors.push('accounts[' + i + ']: kind must be bank or credit'); return; }
      var mask = String(row.mask || '');
      if (!/^\d{4}$/.test(mask)) { report.errors.push('accounts[' + i + ']: mask must be the last 4 digits'); return; }
      accounts.push({
        id: String(row.id),
        institution: String(row.institution || ''),
        mask: mask,
        kind: kind,
        name: String(row.name || (row.institution + ' ···' + mask)),
        balanceKey: row.balanceKey ? String(row.balanceKey) : '',
        freshness: row.freshness ? {
          source: String(row.freshness.source || src.source || ''),
          importedAt: row.freshness.importedAt ? String(row.freshness.importedAt) : '',
          throughDate: row.freshness.throughDate && isISODate(String(row.freshness.throughDate)) ? String(row.freshness.throughDate) : ''
        } : null
      });
    });
    return {
      ok: report.errors.length === 0,
      errors: report.errors,
      accounts: accounts,
      transactions: report.transactions,
      report: report,
      meta: {
        source: String(src.source || 'diamond-ops-finance'),
        importedAt: src.importedAt ? String(src.importedAt) : '',
        live: false,
        label: 'Imported file — not a live bank connection'
      }
    };
  }

  function anyFinanceImport(accounts, transactions) {
    if ((transactions || []).length > 0) return true;
    return (accounts || []).some(function (a) {
      return a && (a.kind === 'bank' || a.kind === 'credit') && accountHasImport(a.id, accounts, transactions);
    });
  }

  function budgetCoverage(budget, accounts, transactions) {
    // Actuals are month-to-date across every imported bank and card account.
    // funding / fundingAccountId are labels only; they must not hide confirmed
    // spend as "unknown" once any finance import exists. Card payments and
    // transfers are not expenses (signedExpense / txMatchesBudget).
    if (anyFinanceImport(accounts, transactions)) return { known: true, reason: '' };
    if (budget.fundingAccountId) {
      return { known: false, reason: 'No import for this account yet. Actual spend is unknown, not $0.' };
    }
    return { known: false, reason: 'No bank or card import yet. Actual spend is unknown, not $0.' };
  }

  function txMatchesBudget(tx, budget) {
    if (!allocationConfirmed(tx)) return false;
    var a = tx.assignment;
    if (a.budgetId && a.budgetId === budget.id) return true;
    if ((a.target === 'category' || a.target === 'budget') && a.category && a.category === budget.category && !a.budgetId) return true;
    return false;
  }

  function paceView(confirmed, budgetAmount, ym, today, known) {
    if (!known) return { projected: null, text: 'Month-end pace unknown' };
    if (!isMonthKey(ym)) return { projected: null, text: 'Month-end pace unknown' };
    var dim = lastDayOfMonth(ym);
    var day = dim;
    if (isISODate(today) && today.slice(0, 7) === ym) day = parseInt(today.slice(8, 10), 10);
    else if (isISODate(today) && today.slice(0, 7) < ym) return { projected: null, text: 'Month-end pace unknown' };
    if (!(day >= 1)) day = 1;
    var projected = cents((Number(confirmed) || 0) / day * dim);
    var diff = cents(projected - (Number(budgetAmount) || 0));
    var text = 'Month-end pace ' + money(projected);
    if (diff > 0) text += ' · ' + money(diff) + ' over the budget';
    else if (diff < 0) text += ' · ' + money(Math.abs(diff)) + ' under the budget';
    else text += ' · on the budget';
    return { projected: projected, text: text, day: day, daysInMonth: dim };
  }

  function accountById(accounts) {
    var map = {};
    (accounts || []).forEach(function (a) { if (a && a.id) map[a.id] = a; });
    return map;
  }

  function inBankBalance(tx, account, balances) {
    if (!tx || tx.status !== 'posted' || !account || account.kind !== 'bank') return false;
    var asOf = '';
    if (account.balanceKey && balances && balances[account.balanceKey]) asOf = balances[account.balanceKey].asOf || '';
    if (!asOf && account.asOf) asOf = account.asOf;
    if (!isISODate(asOf)) return false;
    var when = tx.effectiveDate || tx.purchaseDate;
    return isISODate(when) && when <= asOf;
  }

  function monthPicture(input) {
    var src = input || {};
    var today = src.today || todayISO(new Date());
    var ym = src.month || monthKeyFromDate(today);
    var templates = src.bills || [];
    var accounts = src.accounts || [];
    var acct = accountById(accounts);
    var txs = reconcileTransactions(src.transactions || []);
    var instances = sortInstances(instancesForMonth(templates, src.payments || [], ym, today, txs));
    var summary = summarize(instances);
    var budgets = [];
    templates.forEach(function (t) {
      if (!t || !t.id) return;
      var cls = classifyBill(t);
      if (cls.role !== 'budget') return;
      var funding = inferFunding(t);
      var view = {
        id: t.id,
        name: t.name || 'Expense',
        category: t.category || '',
        notes: t.notes || '',
        budget: cents(t.amount),
        funding: funding,
        fundingAccountId: t.fundingAccountId ? String(t.fundingAccountId) : '',
        estimate: true
      };
      var coverage = budgetCoverage(view, accounts, txs);
      var confirmed = 0, refunds = 0, pendingAmt = 0, postedAmt = 0, count = 0;
      var rows = [];
      var unmatchedOnAccount = 0;
      txs.forEach(function (tx) {
        var purchaseMonth = monthKeyFromDate(tx.purchaseDate);
        var onAccount = view.fundingAccountId && tx.accountId === view.fundingAccountId;
        var sameMonth = purchaseMonth === ym;
        if (onAccount && sameMonth && !allocationConfirmed(tx) && tx.kind !== 'card_payment' && tx.kind !== 'transfer') {
          var delta = (tx.direction === 'in' || tx.kind === 'refund') ? -tx.amount : tx.amount;
          unmatchedOnAccount = cents(unmatchedOnAccount + delta);
        }
        if (!sameMonth || !txMatchesBudget(tx, view)) return;
        var signed = signedExpense(tx);
        confirmed = cents(confirmed + signed);
        if (signed < 0) refunds = cents(refunds + Math.abs(signed));
        if (tx.status === 'pending') pendingAmt = cents(pendingAmt + signed);
        else postedAmt = cents(postedAmt + signed);
        count++;
        rows.push(tx);
      });
      var known = coverage.known;
      var incomplete = known && unmatchedOnAccount !== 0;
      view.actual = {
        state: !known ? 'unknown' : (incomplete ? 'incomplete' : 'ready'),
        amount: known ? confirmed : null,
        confirmed: confirmed,
        pending: pendingAmt,
        posted: postedAmt,
        refunds: refunds,
        count: count,
        unmatchedOnAccount: known ? unmatchedOnAccount : null,
        reason: coverage.reason
      };
      view.remaining = known ? cents(Math.max(0, view.budget - confirmed)) : null;
      view.pace = paceView(confirmed, view.budget, ym, today, known);
      view.percent = (known && view.budget > 0) ? Math.min(100, Math.round((confirmed / view.budget) * 100)) : null;
      view.over = known ? cents(Math.max(0, confirmed - view.budget)) : 0;
      view.transactions = rows.map(function (tx) {
        var a = acct[tx.accountId];
        return {
          id: tx.id,
          merchant: tx.merchant,
          amount: tx.amount,
          signed: signedExpense(tx),
          direction: tx.direction,
          kind: tx.kind,
          purchaseDate: tx.purchaseDate,
          effectiveDate: tx.effectiveDate,
          status: tx.status,
          accountId: tx.accountId,
          accountName: a ? a.name : tx.accountId,
          mask: a ? a.mask : ''
        };
      });
      budgets.push(view);
    });
    budgets.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });

    var unmatched = txs.filter(function (tx) {
      if (allocationConfirmed(tx)) return false;
      if (tx.kind === 'card_payment' || tx.kind === 'transfer') return false;
      return true;
    }).map(function (tx) {
      var a = acct[tx.accountId];
      return {
        id: tx.id,
        merchant: tx.merchant || 'Unknown merchant',
        amount: tx.amount,
        direction: tx.direction,
        kind: tx.kind,
        purchaseDate: tx.purchaseDate,
        effectiveDate: tx.effectiveDate,
        status: tx.status,
        accountId: tx.accountId,
        accountName: a ? a.name : (tx.accountId || 'Unknown account'),
        mask: a ? a.mask : '',
        suggestion: tx.suggestion
      };
    });

    var cardBudgets = {};
    budgets.forEach(function (b) {
      if (b.funding === 'card' && b.fundingAccountId) {
        if (!cardBudgets[b.fundingAccountId]) cardBudgets[b.fundingAccountId] = [];
        cardBudgets[b.fundingAccountId].push(b);
      }
    });

    var liability = {};
    var cardSpend = {};
    txs.forEach(function (tx) {
      var a = acct[tx.accountId];
      if (!a || a.kind !== 'credit') return;
      if (!txOnOrBefore(tx, today)) return;
      if (!liability[a.id]) liability[a.id] = 0;
      liability[a.id] = cents(liability[a.id] + liabilityDelta(tx));
      if (tx.kind === 'card_payment' || tx.kind === 'transfer') return;
      if (monthKeyFromDate(tx.purchaseDate) !== ym) return;
      if (!cardSpend[a.id]) cardSpend[a.id] = 0;
      var spendSign = (tx.direction === 'in' || tx.kind === 'refund') ? -1 : 1;
      cardSpend[a.id] = cents(cardSpend[a.id] + spendSign * tx.amount);
    });
    txs.forEach(function (tx) {
      if (tx.kind !== 'card_payment' || tx.direction !== 'out') return;
      if (!tx.counterAccountId || acct[tx.accountId] && acct[tx.accountId].kind === 'credit') return;
      var groupHasCardLeg = txs.some(function (other) {
        return other !== tx && other.settlementGroup && other.settlementGroup === tx.settlementGroup && acct[other.accountId] && acct[other.accountId].kind === 'credit';
      });
      if (groupHasCardLeg) return;
      if (!txOnOrBefore(tx, today)) return;
      if (!liability[tx.counterAccountId]) liability[tx.counterAccountId] = 0;
      liability[tx.counterAccountId] = cents(liability[tx.counterAccountId] - tx.amount);
    });

    var folded = {};
    instances.forEach(function (inst) {
      if (!inst.settlementAccountId) return;
      if (inst.remaining <= 0) return;
      folded[inst.billId] = inst.settlementAccountId;
    });
    var minimumByCard = {};
    Object.keys(folded).forEach(function (billId) {
      var inst = null;
      instances.forEach(function (row) { if (row.billId === billId) inst = row; });
      var id = folded[billId];
      if (!minimumByCard[id]) minimumByCard[id] = 0;
      minimumByCard[id] = cents(minimumByCard[id] + (inst ? inst.remaining : 0));
    });

    var lines = [];
    var excluded = [];
    var incomplete = false;
    var incompleteReasons = [];
    var fixed = 0;
    instances.forEach(function (inst) {
      if (inst.status === 'paid') return;
      if (folded[inst.billId]) return;
      fixed = cents(fixed + (Number(inst.remaining) || 0));
    });
    lines.push({
      id: 'fixed',
      label: 'Fixed bills still to pay',
      amount: fixed,
      estimate: instances.some(function (inst) { return inst.status !== 'paid' && !folded[inst.billId] && (inst.estimateAmount || inst.estimateDue); }),
      note: 'Dated bills only. Partial payments are already subtracted. Card minimums that belong to a card below are not added again.'
    });

    budgets.forEach(function (b) {
      if (b.funding !== 'card' || b.fundingAccountId) return;
      if (b.actual && b.actual.state !== 'unknown') {
        var spendAll = b.actual.amount == null ? 0 : b.actual.amount;
        lines.push({
          id: 'card-remaining:' + b.id,
          label: b.name + ' still expected on cards',
          amount: cents(Math.max(0, b.budget - spendAll)),
          estimate: true,
          note: 'Budget minus confirmed spend across linked cards. No single card is tied to this budget, so this is not also counted as a bank withdrawal.'
        });
        return;
      }
      excluded.push({
        id: b.id,
        label: b.name,
        amount: b.budget,
        note: 'This looks card-funded, but no card account is tied to it and there is no import yet. It is left out of the cash total instead of being guessed. Actual spend is unknown, not $0.'
      });
      incomplete = true;
      incompleteReasons.push(b.name + ' has no card account on the budget.');
    });

    Object.keys(cardBudgets).forEach(function (accountId) {
      var group = cardBudgets[accountId];
      var a = acct[accountId];
      var imported = accountHasImport(accountId, accounts, txs);
      var labelName = a ? a.name : accountId;
      if (!imported) {
        var sumBudget = 0;
        group.forEach(function (b) { sumBudget = cents(sumBudget + b.budget); });
        lines.push({
          id: 'card-unknown:' + accountId,
          label: labelName + ' budget (actual unknown)',
          amount: sumBudget,
          estimate: true,
          note: 'No import for this card. The budget is counted once. It is not a confirmed $0, and card purchases are not treated as cash that already left the bank.'
        });
        incomplete = true;
        incompleteReasons.push(labelName + ' has no transaction import.');
        return;
      }
      var liab = cents(Math.max(0, liability[accountId] || 0));
      lines.push({
        id: 'card-liability:' + accountId,
        label: labelName + ' unsettled card charges',
        amount: liab,
        estimate: false,
        note: 'Purchases minus refunds and payments already sent to the card. This is cash the bank still has to send. It is not a second copy of the expense.'
      });
      if (group.length > 1 && unmatched.some(function (u) { return u.accountId === accountId; })) {
        incomplete = true;
        incompleteReasons.push(labelName + ' funds more than one budget and still has unmatched charges, so remaining budgets were not reduced by those charges.');
      }
      group.forEach(function (b) {
        var spend = b.actual.amount == null ? 0 : b.actual.amount;
        var extraUnmatched = (group.length === 1 && b.actual.unmatchedOnAccount) ? b.actual.unmatchedOnAccount : 0;
        if (extraUnmatched < 0) extraUnmatched = 0;
        var remain = cents(Math.max(0, b.budget - spend - extraUnmatched));
        lines.push({
          id: 'card-remaining:' + b.id,
          label: b.name + ' still expected on the card',
          amount: remain,
          estimate: true,
          note: 'Budget minus confirmed spend' + (extraUnmatched ? ' and unmatched charges already on this card' : '') + '. Those charges are in the unsettled line, not added again.'
        });
      });
      var base = liab;
      group.forEach(function (b) {
        var spend = b.actual.amount == null ? 0 : b.actual.amount;
        var extraUnmatched = (group.length === 1 && b.actual.unmatchedOnAccount) ? b.actual.unmatchedOnAccount : 0;
        if (extraUnmatched < 0) extraUnmatched = 0;
        base = cents(base + Math.max(0, b.budget - spend - extraUnmatched));
      });
      var floor = minimumByCard[accountId] || 0;
      if (floor > base) {
        lines.push({
          id: 'card-minimum:' + accountId,
          label: labelName + ' extra to reach the minimum payment',
          amount: cents(floor - base),
          estimate: true,
          note: 'The scheduled minimum is higher than unsettled charges plus remaining budget. Only the gap is added.'
        });
      }
    });

    // Card minimums whose card has no budget still need cash.
    Object.keys(minimumByCard).forEach(function (accountId) {
      if (cardBudgets[accountId]) return;
      var a = acct[accountId];
      lines.push({
        id: 'card-minimum-only:' + accountId,
        label: (a ? a.name : accountId) + ' minimum payment',
        amount: minimumByCard[accountId],
        estimate: true,
        note: 'No running budget is tied to this card, so the minimum is the cash need. It is not also treated as a purchase.'
      });
    });

    budgets.forEach(function (b) {
      if (b.funding === 'card') return;
      if (b.actual.state === 'unknown') {
        excluded.push({ id: b.id, label: b.name, amount: b.budget, note: b.actual.reason || 'Left out of the cash total until an import is known.' });
        incomplete = true;
        incompleteReasons.push(b.name + ' is not in the cash total. ' + (b.actual.reason || ''));
        return;
      }
      var reflected = 0;
      txs.forEach(function (tx) {
        if (!txMatchesBudget(tx, b)) return;
        if (monthKeyFromDate(tx.purchaseDate) !== ym && monthKeyFromDate(tx.effectiveDate) !== ym) return;
        if (!inBankBalance(tx, acct[tx.accountId], src.balances || {})) return;
        reflected = cents(reflected + signedExpense(tx));
      });
      var need = cents(Math.max(0, b.budget - Math.max(0, reflected)));
      lines.push({
        id: 'bank-budget:' + b.id,
        label: b.name + ' still to spend from the bank',
        amount: need,
        estimate: true,
        note: reflected > 0
          ? 'Budget minus posted spend already included in the bank balance. The spent amount is not reserved again.'
          : 'Nothing confirmed has posted to the bank yet, so the cash need is the budget once — not the budget plus spend.'
      });
    });

    var pendingUnmatched = 0;
    var pendingPersonal = 0;
    var pendingTransfer = 0;
    var pendingCardPay = 0;
    txs.forEach(function (tx) {
      var a = acct[tx.accountId];
      if (!a || a.kind !== 'bank' || tx.status !== 'pending' || tx.direction !== 'out') return;
      if (tx.kind === 'transfer') { pendingTransfer = cents(pendingTransfer + tx.amount); return; }
      if (tx.kind === 'card_payment') { pendingCardPay = cents(pendingCardPay + tx.amount); return; }
      if (allocationConfirmed(tx) && (tx.assignment.target === 'budget' || tx.assignment.target === 'category')) return;
      if (allocationConfirmed(tx) && tx.assignment.target === 'bill') return;
      if (allocationConfirmed(tx) && tx.assignment.target === 'personal') { pendingPersonal = cents(pendingPersonal + tx.amount); return; }
      pendingUnmatched = cents(pendingUnmatched + tx.amount);
    });
    if (pendingUnmatched) lines.push({ id: 'pending-unmatched', label: 'Unmatched pending bank withdrawals', amount: pendingUnmatched, estimate: false, note: 'Not assigned to a bill, category, or transfer. Shown here so they are not dropped, and not counted as a confirmed expense.' });
    if (pendingPersonal) lines.push({ id: 'pending-personal', label: 'Pending personal withdrawals', amount: pendingPersonal, estimate: false, note: 'Cash leaving the bank. Not an operating expense.' });
    if (pendingTransfer) lines.push({ id: 'pending-transfer', label: 'Pending transfers out', amount: pendingTransfer, estimate: false, note: 'Moves between accounts. Not income or an expense. Posted transfers are already in the balances.' });
    if (pendingCardPay) lines.push({ id: 'pending-card-pay', label: 'Pending payments to cards', amount: pendingCardPay, estimate: false, note: 'Cash leaving the bank to settle a card. The card purchases themselves are not also subtracted as bank cash.' });

    var chase = balanceView(src.balances && src.balances.chase0714, today);
    var boa = balanceView(src.balances && src.balances.boa1003, today);
    var bankCash = (chase.amount == null || boa.amount == null) ? null : cents(chase.amount + boa.amount);
    var totalOut = 0;
    lines.forEach(function (line) { totalOut = cents(totalOut + (Number(line.amount) || 0)); });
    var cashAfter = bankCash == null ? null : cents(bankCash - totalOut);
    var accountRows = accounts.map(function (a) {
      var pending = 0, posted = 0;
      txs.forEach(function (tx) {
        if (tx.accountId !== a.id) return;
        if (tx.status === 'pending') pending++;
        else posted++;
      });
      var fresh = a.freshness || null;
      return {
        id: a.id,
        name: a.name,
        mask: a.mask,
        kind: a.kind,
        imported: !!(fresh && (fresh.importedAt || fresh.throughDate)) || pending + posted > 0,
        importedAt: fresh && fresh.importedAt ? fresh.importedAt : '',
        throughDate: fresh && fresh.throughDate ? fresh.throughDate : '',
        source: fresh && fresh.source ? fresh.source : '',
        pending: pending,
        posted: posted
      };
    });
    var importAt = latestImportAt(accounts, txs, src.importMeta || {});
    return {
      today: today,
      month: ym,
      instances: instances,
      summary: summary,
      categories: byCategory(instances),
      budgets: budgets,
      unmatched: unmatched,
      forecast: {
        bankCash: bankCash,
        lines: lines,
        excluded: excluded,
        totalOut: totalOut,
        cashAfter: cashAfter,
        incomplete: incomplete,
        incompleteReasons: incompleteReasons,
        foldedBillIds: Object.keys(folded)
      },
      accounts: accountRows,
      importMeta: {
        present: !!importAt,
        importedAt: importAt,
        live: false,
        source: (src.importMeta && src.importMeta.source) || 'diamond-ops-finance',
        label: (src.importMeta && src.importMeta.label) || (importAt ? 'Latest imported file — not a live bank connection' : 'No transaction import yet')
      }
    };
  }

  // Fixed preview set. Round figures and a SAMPLE note — not the company books.
  function stampBill(b, extra) {
    var prepared = prepareTemplate(Object.assign({ updatedBy: 'sample', createdAt: '2026-11-01T15:00:00.000Z' }, b));
    var bill = prepared.bill;
    bill.updatedAt = '2026-11-01T15:00:00.000Z';
    if (extra) Object.keys(extra).forEach(function (k) { bill[k] = extra[k]; });
    return bill;
  }

  function sampleData(today) {
    var day = today || '2026-11-14';
    var ym = monthKeyFromDate(day) || '2026-11';
    var bills = [
      stampBill({ id: 'bill_payroll', name: 'Crew payroll', category: 'Payroll', amount: 8500, recurrence: 'monthly', dueDay: 1, type: 'fixed', notes: 'Sample figure for preview.' }),
      stampBill({ id: 'bill_rent', name: 'Shop rent', category: 'Rent & storage', amount: 2200, recurrence: 'monthly', dueDay: 3, type: 'fixed', notes: 'Sample figure for preview.' }),
      stampBill({ id: 'bill_truck', name: 'Truck payment', category: 'Vehicles & equipment', amount: 740, recurrence: 'monthly', dueDay: 8, type: 'fixed', notes: 'Sample figure for preview.' }),
      stampBill({ id: 'bill_phone', name: 'Phone & software', category: 'Services/software/phone', amount: 285, recurrence: 'monthly', dueDay: 12, type: 'fixed', notes: 'Sample figure for preview.' }),
      stampBill({ id: 'bill_insurance', name: 'Liability insurance', category: 'Insurance', amount: 640, recurrence: 'monthly', dueDay: 16, type: 'fixed', notes: 'Sample figure for preview.' }),
      stampBill({ id: 'bill_affirm', name: 'Affirm mower', category: 'Card minimums/Affirm', amount: 175, recurrence: 'monthly', dueDay: 22, type: 'credit_card', variableAmount: true, notes: 'Sample card minimum. Mark paid asks for the real amount.' }),
      stampBill({ id: 'bill_loan', name: 'Equipment loan', category: 'Loans', amount: 410, recurrence: 'monthly', dueDay: 27, type: 'fixed', notes: 'Sample figure for preview.' }),
      stampBill({ id: 'bill_draw', name: 'Owner draw', category: 'Personal', amount: 1000, recurrence: 'monthly', dueDay: 28, type: 'fixed', notes: 'Sample figure for preview.' }),
      stampBill({ id: 'bill_cardmin', name: 'Sample card minimum', category: 'Card minimums/Affirm', amount: 90, recurrence: 'monthly', dueDay: 28, type: 'credit_card', variableAmount: true, notes: 'Estimated minimums; due day unknown (28th placeholder). Enter actual. SAMPLE card minimum, not a budget.' }, { settlementAccountId: 'capone-9618' }),
      stampBill({ id: 'bill_person', name: 'Sample note payable', category: 'Loans', amount: 500, recurrence: 'monthly', dueDay: 29, type: 'fixed', notes: 'Purpose unconfirmed. SAMPLE.' }),
      stampBill({ id: 'bill_fee', name: 'Sample checking fee', category: 'Services/software/phone', amount: 15, recurrence: 'monthly', dueDay: 30, type: 'fixed', notes: 'Only if the balance is under the bank limit. SAMPLE.' }),
      stampBill({ id: 'bill_fuel_card', name: 'Sample fuel card', category: 'Fuel', amount: 800, recurrence: 'monthly', dueDay: 30, type: 'fixed', notes: 'Paid off weekly; owner estimate. Enter actual. SAMPLE.' }, { funding: 'card', fundingAccountId: 'capone-9618' }),
      stampBill({ id: 'bill_fuel_debit', name: 'Sample fuel debit', category: 'Fuel', amount: 120, recurrence: 'monthly', dueDay: 30, type: 'fixed', notes: 'SAMPLE May-Sep average. Enter actual. Paid directly (debit).' }, { funding: 'bank', fundingAccountId: 'boa-1003' }),
      stampBill({ id: 'bill_dump', name: 'Sample dump fees', category: 'Crew operating', amount: 200, recurrence: 'monthly', dueDay: 30, type: 'fixed', notes: 'Monthly estimate. Enter actual. Paid from checking. SAMPLE.' }, { funding: 'bank', fundingAccountId: 'chase-0714' }),
      stampBill({ id: 'bill_supplies', name: 'Sample crew supplies', category: 'Crew operating', amount: 450, recurrence: 'monthly', dueDay: 30, type: 'fixed', notes: 'Monthly estimate. Enter actual. SAMPLE.' }, { funding: 'unknown', fundingAccountId: 'capone-2529' })
    ];
    var payroll = buildPayment({ billId: 'bill_payroll', month: ym, amount: 8500 }, 8500, ym + '-01', 'sample-manager');
    var rent = buildPayment({ billId: 'bill_rent', month: ym, amount: 2200 }, 1000, ym + '-03', 'sample-manager');
    var importedAt = '2026-11-13T15:04:00.000Z';
    function tx(row) {
      var prepared = normalizeTransaction(Object.assign({ source: 'diamond-ops-finance', importedAt: importedAt }, row));
      if (!prepared.ok) throw new Error(prepared.error);
      return prepared.tx;
    }
    var manual = { confidence: 'manual', confirmed: true };
    var transactions = [
      tx(Object.assign({ sourceId: 'sample-fuel-200', accountId: 'capone-9618', amount: 200, direction: 'out', kind: 'card_purchase', purchaseDate: ym + '-04', effectiveDate: ym + '-05', status: 'posted', merchant: 'Sample Fuel Stop', target: 'budget', budgetId: 'bill_fuel_card', category: 'Fuel' }, manual)),
      tx(Object.assign({ sourceId: 'sample-fuel-refund', accountId: 'capone-9618', amount: 20, direction: 'in', kind: 'refund', purchaseDate: ym + '-08', effectiveDate: ym + '-08', status: 'posted', merchant: 'Sample Fuel Stop refund', target: 'budget', budgetId: 'bill_fuel_card', category: 'Fuel' }, manual)),
      tx(Object.assign({ sourceId: 'sample-fuel-pending', accountId: 'capone-9618', amount: 30, direction: 'out', kind: 'card_purchase', purchaseDate: ym + '-11', effectiveDate: ym + '-11', status: 'pending', merchant: 'Sample Fuel Pending', target: 'budget', budgetId: 'bill_fuel_card', category: 'Fuel' }, manual)),
      tx({ sourceId: 'sample-fuel-unknown', accountId: 'capone-9618', amount: 25, direction: 'out', kind: 'card_purchase', purchaseDate: ym + '-12', effectiveDate: ym + '-12', status: 'pending', merchant: 'Sample Corner Store', confidence: 'low', confirmed: false, target: 'budget', budgetId: 'bill_fuel_card', category: 'Fuel' }),
      tx({ sourceId: 'sample-card-pay', accountId: 'capone-9618', amount: 80, direction: 'in', kind: 'card_payment', purchaseDate: ym + '-07', effectiveDate: ym + '-07', status: 'posted', merchant: 'Payment from sample checking', settlementGroup: 'sample-pay-1' }),
      tx({ sourceId: 'sample-bank-pay', accountId: 'chase-0714', counterAccountId: 'capone-9618', amount: 80, direction: 'out', kind: 'card_payment', purchaseDate: ym + '-07', effectiveDate: ym + '-07', status: 'posted', merchant: 'Payment to sample card', settlementGroup: 'sample-pay-1' }),
      tx(Object.assign({ sourceId: 'sample-dump-40', accountId: 'chase-0714', amount: 40, direction: 'out', kind: 'bank_debit', purchaseDate: ym + '-05', effectiveDate: ym + '-05', status: 'posted', merchant: 'Sample Dump', target: 'budget', budgetId: 'bill_dump', category: 'Crew operating' }, manual)),
      tx({ sourceId: 'sample-market-15', accountId: 'chase-0714', amount: 15, direction: 'out', kind: 'unknown', purchaseDate: ym + '-13', effectiveDate: ym + '-13', status: 'pending', merchant: 'Sample Market' }),
      tx({ sourceId: 'sample-transfer-500', accountId: 'chase-0714', counterAccountId: 'boa-1003', amount: 500, direction: 'out', kind: 'transfer', purchaseDate: ym + '-02', effectiveDate: ym + '-02', status: 'posted', merchant: 'Transfer to sample checking', settlementGroup: 'sample-xfer-1' })
    ];
    var fresh = { source: 'diamond-ops-finance', importedAt: importedAt, throughDate: '2026-11-12' };
    var accounts = [
      { id: 'chase-0714', institution: 'Chase', mask: '0714', kind: 'bank', name: 'Chase checking ···0714', balanceKey: 'chase0714', freshness: fresh },
      { id: 'boa-1003', institution: 'Bank of America', mask: '1003', kind: 'bank', name: 'Bank of America ···1003', balanceKey: 'boa1003', freshness: fresh },
      { id: 'capone-9618', institution: 'Capital One', mask: '9618', kind: 'credit', name: 'Capital One ···9618', freshness: fresh },
      { id: 'capone-2529', institution: 'Capital One', mask: '2529', kind: 'credit', name: 'Capital One ···2529', freshness: null },
      { id: 'capone-2316', institution: 'Capital One', mask: '2316', kind: 'credit', name: 'Capital One ···2316', freshness: null },
      { id: 'capone-2352', institution: 'Capital One', mask: '2352', kind: 'credit', name: 'Capital One ···2352', freshness: null },
      { id: 'capone-0698', institution: 'Capital One', mask: '0698', kind: 'credit', name: 'Capital One ···0698', freshness: null }
    ];
    var balances = normalizeBalances({
      chase0714: { amount: 18420.55, asOf: '2026-11-12', source: 'manual' },
      boa1003: { amount: 6110, asOf: '2026-11-12', source: 'manual' },
      quickbooks: { asOf: '2026-11-12', source: 'manual', connected: false },
      updatedAt: '2026-11-12T15:00:00.000Z',
      updatedBy: 'sample'
    });
    var invoices = [
      prepareInvoice({ id: 'inv_1044', customer: 'Palm Court HOA', invoiceNumber: 'INV-1044', amount: 2400, dueDate: '2026-11-01', status: 'open', source: 'manual', notes: 'Sample invoice.', updatedBy: 'sample', createdAt: '2026-11-01T15:00:00.000Z' }).invoice,
      prepareInvoice({ id: 'inv_1045', customer: 'Sample Residence', invoiceNumber: 'INV-1045', amount: 1250, dueDate: '2026-11-20', status: 'open', source: 'manual', notes: 'Sample invoice.', updatedBy: 'sample', createdAt: '2026-11-01T15:00:00.000Z' }).invoice,
      prepareInvoice({ id: 'inv_1046', customer: 'Harbor Club', invoiceNumber: 'INV-1046', amount: 1200, dueDate: '2026-11-28', status: 'open', source: 'manual', notes: 'Sample invoice.', updatedBy: 'sample', createdAt: '2026-11-01T15:00:00.000Z' }).invoice
    ].map(function (inv) { inv.updatedAt = '2026-11-12T15:00:00.000Z'; return inv; });
    return {
      balances: balances,
      bills: bills,
      payments: [payroll, rent],
      invoices: invoices,
      transactions: transactions,
      accounts: accounts,
      importMeta: { source: 'diamond-ops-finance', importedAt: importedAt, live: false, label: 'SAMPLE import — not a live bank connection' },
      sample: true
    };
  }

  var api = {
    CATEGORIES: CATEGORIES,
    CATEGORY_COLORS: CATEGORY_COLORS,
    STALE_DAYS: STALE_DAYS,
    EMPTY_INVOICES_TITLE: 'Connect QuickBooks',
    cents: cents,
    todayISO: todayISO,
    isISODate: isISODate,
    isMonthKey: isMonthKey,
    monthKeyFromDate: monthKeyFromDate,
    monthKeyOf: monthKeyOf,
    addMonths: addMonths,
    addDays: addDays,
    daysBetween: daysBetween,
    lastDayOfMonth: lastDayOfMonth,
    prettyDate: prettyDate,
    monthLabel: monthLabel,
    money: money,
    needsAmountPrompt: needsAmountPrompt,
    dueDateFor: dueDateFor,
    paymentFor: paymentFor,
    paymentsFor: paymentsFor,
    statusOf: statusOf,
    billStatus: billStatus,
    instancesForMonth: instancesForMonth,
    sortInstances: sortInstances,
    summarize: summarize,
    byCategory: byCategory,
    balanceView: balanceView,
    cashAfter: cashAfter,
    invoiceSummary: invoiceSummary,
    invoiceDaysOverdue: invoiceDaysOverdue,
    paymentId: paymentId,
    buildPayment: buildPayment,
    prepareTemplate: prepareTemplate,
    prepareInvoice: prepareInvoice,
    emptyBalances: emptyBalances,
    normalizeBalances: normalizeBalances,
    validateImport: validateImport,
    classifyBill: classifyBill,
    inferFunding: inferFunding,
    migrationPlan: migrationPlan,
    normalizeTransaction: normalizeTransaction,
    reconcileTransactions: reconcileTransactions,
    summarizeImport: summarizeImport,
    prepareImport: prepareImport,
    monthPicture: monthPicture,
    sampleData: sampleData
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Bills = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
