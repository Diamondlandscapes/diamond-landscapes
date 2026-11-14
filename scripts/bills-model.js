// Bills & Expenses — pure month math. No Firebase, no DOM.
// Loaded by index.html as a classic script (window.Bills) and by the
// seed script / tests via require. Amounts are never invented here:
// a missing balance stays null so the screen can show an em dash.
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
  var STATUS_RANK = { overdue: 0, due_soon: 1, upcoming: 2, paid: 3 };

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

  function instancesForMonth(templates, payments, ym, today) {
    var list = [];
    (templates || []).forEach(function (t) {
      if (!t || !t.id) return;
      if (t.active === false) {
        var historical = paymentFor(payments, t.id, ym);
        if (!historical) return;
      }
      var due = dueDateFor(t, ym);
      if (!due && t.recurrence === 'once') return;
      if (!due && t.recurrence !== 'monthly') return;
      if (!due) return;
      var pay = paymentFor(payments, t.id, ym);
      var paid = !!pay;
      var expected = t.amount;
      if (paid && pay.expectedAmount != null && pay.expectedAmount !== '' && isFinite(Number(pay.expectedAmount))) {
        expected = Number(pay.expectedAmount);
      }
      var st = statusOf(due, paid, today);
      var late = (!paid && isISODate(due) && due < today) ? daysBetween(due, today) : 0;
      list.push({
        billId: t.id,
        name: t.name || 'Bill',
        category: t.category || '',
        notes: t.notes || '',
        type: t.type || 'fixed',
        variableAmount: needsAmountPrompt(t),
        recurrence: t.recurrence || 'monthly',
        amount: cents(expected),
        dueDate: due,
        month: ym,
        status: st,
        paid: paid,
        amountPaid: paid ? cents(pay.amountPaid) : null,
        paidAt: paid ? (pay.paidAt || '') : '',
        paidBy: paid ? (pay.paidBy || '') : '',
        paymentId: paid ? (pay.id || paymentId(t.id, ym)) : paymentId(t.id, ym),
        daysOverdue: late || 0
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
      if (inst.status === 'paid') {
        paid = cents(paid + (Number(inst.amountPaid) || 0));
      } else {
        unpaid = cents(unpaid + (Number(inst.amount) || 0));
        if (inst.status === 'overdue') {
          overdue = cents(overdue + (Number(inst.amount) || 0));
          overdueCount++;
        } else if (inst.status === 'due_soon') {
          dueSoon = cents(dueSoon + (Number(inst.amount) || 0));
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

  // Fixed preview set. Round figures and a SAMPLE note — not the company books.
  function sampleData(today) {
    var day = today || '2026-11-14';
    var ym = monthKeyFromDate(day) || '2026-11';
    var bills = [
      { id: 'bill_payroll', name: 'Crew payroll', category: 'Payroll', amount: 8500, recurrence: 'monthly', dueDay: 1, type: 'fixed', notes: 'Sample figure for preview.' },
      { id: 'bill_rent', name: 'Shop rent', category: 'Rent & storage', amount: 2200, recurrence: 'monthly', dueDay: 3, type: 'fixed', notes: 'Sample figure for preview.' },
      { id: 'bill_truck', name: 'Truck payment', category: 'Vehicles & equipment', amount: 740, recurrence: 'monthly', dueDay: 8, type: 'fixed', notes: 'Sample figure for preview.' },
      { id: 'bill_phone', name: 'Phone & software', category: 'Services/software/phone', amount: 285, recurrence: 'monthly', dueDay: 12, type: 'fixed', notes: 'Sample figure for preview.' },
      { id: 'bill_insurance', name: 'Liability insurance', category: 'Insurance', amount: 640, recurrence: 'monthly', dueDay: 16, type: 'fixed', notes: 'Sample figure for preview.' },
      { id: 'bill_supplies', name: 'Crew supplies', category: 'Crew operating', amount: 350, recurrence: 'monthly', dueDay: 19, type: 'fixed', notes: 'Sample figure for preview.' },
      { id: 'bill_affirm', name: 'Affirm mower', category: 'Card minimums/Affirm', amount: 175, recurrence: 'monthly', dueDay: 22, type: 'credit_card', variableAmount: true, notes: 'Sample card minimum. Mark paid asks for the real amount.' },
      { id: 'bill_fuel', name: 'Fuel card', category: 'Fuel', amount: 900, recurrence: 'monthly', dueDay: 25, type: 'fixed', notes: 'Sample figure for preview.' },
      { id: 'bill_loan', name: 'Equipment loan', category: 'Loans', amount: 410, recurrence: 'monthly', dueDay: 27, type: 'fixed', notes: 'Sample figure for preview.' },
      { id: 'bill_draw', name: 'Owner draw', category: 'Personal', amount: 1000, recurrence: 'monthly', dueDay: 28, type: 'fixed', notes: 'Sample figure for preview.' }
    ].map(function (b) {
      var prepared = prepareTemplate(Object.assign({ updatedBy: 'sample', createdAt: '2026-11-01T15:00:00.000Z' }, b));
      var bill = prepared.bill;
      bill.updatedAt = '2026-11-01T15:00:00.000Z';
      return bill;
    });
    var pay = buildPayment(
      { billId: 'bill_payroll', month: ym, amount: 8500 },
      8500,
      ym + '-01',
      'sample-manager'
    );
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
    return { balances: balances, bills: bills, payments: [pay], invoices: invoices, sample: true };
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
    statusOf: statusOf,
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
    sampleData: sampleData
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Bills = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
