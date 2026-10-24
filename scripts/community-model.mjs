// Pure helpers for multi-unit communities (Lexington Club and later HOAs).
// Villages and unit addresses are nested on ONE property. They are not customers.
// The in-app importer in index.html (buildCommunityFromCsvText) must stay in sync.

export function parseCsv(text) {
  var raw = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  var lines = raw.split('\n').filter(function(l) { return l.trim(); });
  if (!lines.length) return [];
  var headers = parseCsvLine(lines[0]).map(normalizeHeader);
  var rows = [];
  for (var i = 1; i < lines.length; i++) {
    var cols = parseCsvLine(lines[i]);
    if (!cols.some(function(c) { return String(c || '').trim(); })) continue;
    var row = {};
    headers.forEach(function(h, idx) { row[h] = String(cols[idx] == null ? '' : cols[idx]).trim(); });
    rows.push(row);
  }
  return rows;
}

export function parseCsvLine(line) {
  var result = [];
  var cur = '';
  var inQ = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      result.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  result.push(cur.trim());
  return result;
}

export function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/[\s\-]+/g, '_');
}

function villageSortKey(name) {
  var n = parseInt(String(name).replace(/\D/g, ''), 10);
  return isNaN(n) ? 9999 : n;
}

function addressSort(a, b) {
  var dn = (parseInt(a.streetNumber, 10) || 0) - (parseInt(b.streetNumber, 10) || 0);
  if (dn) return dn;
  var street = String(a.street || '').localeCompare(String(b.street || ''));
  if (street) return street;
  return String(a.unit || '').localeCompare(String(b.unit || ''));
}

// rows: objects keyed by normalized headers
// (village, street_number, unit, street, full_address, parcel_id, source).
export function buildCommunityFromRows(rows) {
  var byVillage = {};
  var order = [];
  var seen = {};
  var skipped = 0;
  (rows || []).forEach(function(r) {
    var village = String(r.village || '').trim();
    if (!village) { skipped++; return; }
    var streetNumber = String(r.street_number || r.streetnumber || '').trim();
    var unit = String(r.unit || '').trim();
    var street = String(r.street || '').trim();
    var full = String(r.full_address || r.fulladdress || '').trim();
    var parcel = String(r.parcel_id || r.parcelid || '').trim();
    var id = parcel || [village, streetNumber, unit, street].join('|');
    if (seen[id]) { skipped++; return; }
    seen[id] = 1;
    if (!byVillage[village]) { byVillage[village] = []; order.push(village); }
    var label = (streetNumber + (unit ? ' Unit ' + unit : '')).trim();
    byVillage[village].push({
      id: id,
      streetNumber: streetNumber,
      unit: unit,
      street: street,
      fullAddress: full || [streetNumber, street, unit ? 'Unit ' + unit : ''].filter(Boolean).join(' '),
      parcelId: parcel,
      label: label || full || id
    });
  });
  var source = '';
  (rows || []).some(function(r) {
    if (r.source) { source = String(r.source).slice(0, 300); return true; }
    return false;
  });
  var villages = order.map(function(name) {
    return {
      name: name,
      sort: villageSortKey(name),
      addresses: byVillage[name].slice().sort(addressSort)
    };
  }).sort(function(a, b) {
    if (a.sort !== b.sort) return a.sort - b.sort;
    return a.name.localeCompare(b.name);
  });
  return {
    enabled: true,
    source: source,
    villages: villages,
    skipped: skipped
  };
}

export function buildCommunityFromCsvText(text) {
  return buildCommunityFromRows(parseCsv(text));
}

export function communityCounts(community) {
  var villages = (community && community.villages) || [];
  var addresses = 0;
  villages.forEach(function(v) { addresses += (v.addresses || []).length; });
  return { villages: villages.length, addresses: addresses };
}

export function villageCountMap(community) {
  var out = {};
  ((community && community.villages) || []).forEach(function(v) {
    out[v.name] = (v.addresses || []).length;
  });
  return out;
}

// Firestore REST value encoder for the emulator seed only.
export function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === 'object') {
    var fields = {};
    Object.keys(value).forEach(function(k) {
      if (value[k] !== undefined) fields[k] = toFirestoreValue(value[k]);
    });
    return { mapValue: { fields: fields } };
  }
  return { stringValue: String(value) };
}
