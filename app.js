
/*
  S S Textile Billing — Professional Offline Invoice App with WhatsApp Integration
  - localStorage: sst_meta_v1, sst_customers_v1, sst_invoices_v1
  - GST: 5% total (2.5% CGST + 2.5% SGST)
  - WhatsApp: Direct message sharing with invoice details
*/

const STORAGE_META = 'sst_meta_v1';
const STORAGE_CUST = 'sst_customers_v1';
const STORAGE_INV = 'sst_invoices_v1';
const TAX_TOTAL_PERCENT = 5;
const TAX_HALF = TAX_TOTAL_PERCENT / 2;

let currentInvoiceForWhatsapp = null;

// Utilities
const $ = id => document.getElementById(id);
const fmt = v => Number(v).toLocaleString('en-IN', { style:'currency', currency:'INR' });

function loadJSON(key, def) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(def)); }
  catch(e) { return def; }
}

function saveJSON(key, obj) {
  localStorage.setItem(key, JSON.stringify(obj));
}

// Initialize storage
function initStorage() {
  let meta = loadJSON(STORAGE_META, {});
  if(!meta.lastInv) meta.lastInv = 0;
  saveJSON(STORAGE_META, meta);

  let cust = loadJSON(STORAGE_CUST, []);
  saveJSON(STORAGE_CUST, cust);

  let inv = loadJSON(STORAGE_INV, []);
  saveJSON(STORAGE_INV, inv);
}

// Invoice number generator
function nextInvoiceNumber(persist=true) {
  let meta = loadJSON(STORAGE_META, {});
  meta.lastInv = (meta.lastInv || 0) + 1;
  if(persist) saveJSON(STORAGE_META, meta);
  const padded = String(meta.lastInv).padStart(4,'0');
  return `SST-${padded}`;
}

// State
let items = [];
let editingInvoiceId = null;

function refreshCounts() {
  const customers = loadJSON(STORAGE_CUST, []);
  const invoices = loadJSON(STORAGE_INV, []);
  $('countCustomers').innerText = customers.length;
  $('countInvoices').innerText = invoices.length;
  $('lastInv').innerText = invoices.length ? invoices[0].inv : '—';
  populateCustomerSelect();
  populateMonthFilter();
}

// Customer functions
function populateCustomerSelect() {
  const sel = $('custSelect');
  const mobile = $('custMobileSelect');
  const current = sel.value || '';
  sel.innerHTML = '<option value="">-- Select Customer --</option>';
  const customers = loadJSON(STORAGE_CUST, []);
  customers.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.dataset.mobile = c.mobile || '';
    opt.dataset.gstin = c.gstin || '';
    opt.dataset.addr = c.address || '';
    opt.textContent = `${c.name}${c.mobile ? ' • ' + c.mobile : ''}`;
    sel.appendChild(opt);
  });
  sel.value = current;
  sel.onchange = () => {
    const selected = sel.options[sel.selectedIndex];
    if(selected && selected.dataset) {
      mobile.value = selected.dataset.mobile || '';
    }
  };
}

$('saveCustomerBtn').addEventListener('click', () => {
  const name = $('custName').value.trim();
  if(!name) { alert('Customer name required'); return; }
  const mobile = $('custMobile').value.trim();
  const gstin = $('custGst').value.trim();
  const addr = $('custAddr').value.trim();
  let customers = loadJSON(STORAGE_CUST, []);
  const idx = customers.findIndex(c => c.name === name && (c.mobile === mobile || !mobile));
  if(idx >= 0) {
    customers[idx] = {name, mobile, gstin, address:addr};
  } else {
    customers.unshift({name, mobile, gstin, address:addr});
  }
  saveJSON(STORAGE_CUST, customers);
  $('custName').value=''; $('custMobile').value=''; $('custGst').value=''; $('custAddr').value='';
  populateCustomerSelect(); refreshCounts();
  alert('✓ Customer saved');
});

$('clearCustomerBtn').addEventListener('click', () => {
  $('custName').value=''; $('custMobile').value=''; $('custGst').value=''; $('custAddr').value='';
});

// Items management
function renderItems() {
  const tbody = document.querySelector('#itemsTable tbody');
  tbody.innerHTML = '';
  let subtotal = 0;
  items.forEach((it, idx) => {
    const tr = document.createElement('tr');
    const amt = Number(it.qty || 0) * Number(it.rate || 0);
    subtotal += amt;
    tr.innerHTML = `<td>${escapeHtml(it.name)}</td>
      <td class="text-center">${it.qty}</td>
      <td class="text-right">${fmt(it.rate)}</td>
      <td class="text-right"><strong>${fmt(amt)}</strong></td>
      <td class="text-center">
        <button class="btn-icon" onclick="editItem(${idx})" title="Edit">✎</button>
        <button class="btn-icon" onclick="removeItem(${idx})" title="Delete">✕</button>
      </td>`;
    tbody.appendChild(tr);
  });
  const cgst = round2(subtotal * (TAX_HALF/100));
  const sgst = round2(subtotal * (TAX_HALF/100));
  const grand = round2(subtotal + cgst + sgst);
  $('subtotalCell').innerText = fmt(subtotal);
  $('cgstCell').innerText = fmt(cgst);
  $('sgstCell').innerText = fmt(sgst);
  $('grandTotalCell').innerText = fmt(grand);
  return {subtotal, cgst, sgst, grand};
}

function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }

$('addItemBtn').addEventListener('click', () => {
  const name = $('itemName').value.trim();
  const qty = Number($('itemQty').value || 0);
  const rate = Number($('itemRate').value || 0);
  if(!name) { alert('Enter item description'); return; }
  if(qty <= 0) { alert('Quantity must be > 0'); return; }
  if(rate < 0) { alert('Rate must be ≥ 0'); return; }
  items.push({name, qty, rate});
  $('itemName').value = ''; $('itemQty').value = ''; $('itemRate').value = '';
  renderItems();
});

function editItem(idx) {
  const it = items[idx];
  if(!it) return;
  $('itemName').value = it.name;
  $('itemQty').value = it.qty;
  $('itemRate').value = it.rate;
  items.splice(idx, 1);
  renderItems();
}

function removeItem(idx) {
  if(!confirm('Remove this item?')) return;
  items.splice(idx, 1);
  renderItems();
}

$('clearItemsBtn').addEventListener('click', () => {
  if(!confirm('Clear all items?')) return;
  items = [];
  renderItems();
});

// Save invoice
$('saveInvoiceBtn').addEventListener('click', () => {
  const invNoField = $('invNo');
  let invNo = invNoField.value.trim();
  const invDate = $('invDate').value || new Date().toISOString().slice(0,10);
  const customer = $('custSelect').value.trim() || 'Walk-in';
  const custMobile = $('custMobileSelect').value.trim() || '';
  if(items.length === 0) { alert('Add at least one item'); return; }
  if(!invNo) invNo = nextInvoiceNumber(true);
  const totals = renderItems();
  let invoices = loadJSON(STORAGE_INV, []);
  if(editingInvoiceId) {
    const idx = invoices.findIndex(i=>i.id === editingInvoiceId);
    if(idx >= 0) {
      invoices[idx] = {
        ...invoices[idx],
        inv: invNo, date: invDate, customer, customerMobile: custMobile,
        items: items.slice(), subtotal: totals.subtotal, cgst: totals.cgst,
        sgst: totals.sgst, total: totals.grand, updatedAt: new Date().toISOString()
      };
      alert('✓ Invoice updated');
    }
    editingInvoiceId = null;
  } else {
    const id = 'inv_' + Date.now();
    invoices.unshift({
      id, inv: invNo, date: invDate, customer, customerMobile: custMobile,
      items: items.slice(), subtotal: totals.subtotal, cgst: totals.cgst,
      sgst: totals.sgst, total: totals.grand, createdAt: new Date().toISOString()
    });
    alert('✓ Invoice saved');
  }
  saveJSON(STORAGE_INV, invoices);
  invNoField.value = nextInvoiceNumber(true);
  $('invDate').value = new Date().toISOString().slice(0,10);
  items = [];
  renderItems();
  refreshHistory();
  refreshCounts();
});

// Edit invoice
function editInvoice(id) {
  const invoices = loadJSON(STORAGE_INV, []);
  const inv = invoices.find(i=>i.id === id);
  if(!inv) return alert('Invoice not found');
  editingInvoiceId = id;
  $('invNo').value = inv.inv;
  $('invDate').value = inv.date;
  $('custSelect').value = inv.customer;
  $('custMobileSelect').value = inv.customerMobile || '';
  items = inv.items.map(it => ({...it}));
  renderItems();
  window.scrollTo({top: 0, behavior: 'smooth'});
}

// Delete invoice
function deleteInvoice(id) {
  if(!confirm('Delete this invoice permanently?')) return;
  let invoices = loadJSON(STORAGE_INV, []);
  invoices = invoices.filter(i=>i.id !== id);
  saveJSON(STORAGE_INV, invoices);
  refreshHistory();
  refreshCounts();
}

// WhatsApp Functions
function openWhatsappModal(invId) {
  const invoices = loadJSON(STORAGE_INV, []);
  const inv = invoices.find(i => i.id === invId);
  if(!inv) return alert('Invoice not found');
  
  currentInvoiceForWhatsapp = inv;
  $('whatsappPhone').value = inv.customerMobile ? inv.customerMobile.replace(/\D/g, '') : '';
  
  // Pre-fill message
  const itemsList = inv.items.map(it => `${it.name} - Qty: ${it.qty} @ ₹${it.rate}`).join('\n');
  const defaultMsg = `Hello ${inv.customer},\n\nInvoice: ${inv.inv}\nDate: ${inv.date}\n\nItems:\n${itemsList}\n\nSubtotal: ₹${inv.subtotal.toFixed(2)}\nGST (5%): ₹${(inv.cgst + inv.sgst).toFixed(2)}\nTotal: ₹${inv.total.toFixed(2)}\n\nThank you!`;
  $('whatsappMessage').value = defaultMsg;
  
  $('whatsappModal').classList.add('active');
}

function closeWhatsappModal() {
  $('whatsappModal').classList.remove('active');
  currentInvoiceForWhatsapp = null;
}

$('sendWhatsappBtn').addEventListener('click', () => {
  const phone = $('whatsappPhone').value.trim();
  const message = $('whatsappMessage').value.trim();
  
  if(!phone) { alert('Please enter customer mobile number'); return; }
  if(!message) { alert('Please enter a message'); return; }
  
  // Format phone: remove any non-digits and ensure it has country code
  const cleanPhone = phone.replace(/\D/g, '');
  if(cleanPhone.length < 10) { alert('Invalid phone number'); return; }
  
  // Create WhatsApp message URL
  const encodedMsg = encodeURIComponent(message);
  const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodedMsg}`;
  
  // Open WhatsApp
  window.open(whatsappUrl, '_blank');
  
  closeWhatsappModal();
  alert('✓ Opening WhatsApp...');
});

// History
function refreshHistory(filterText='') {
  const tbody = document.querySelector('#historyTable tbody');
  tbody.innerHTML = '';
  const invoices = loadJSON(STORAGE_INV, []);
  const f = (filterText||'').toLowerCase().trim();
  const filtered = invoices.filter(inv => {
    if(!f) return true;
    return (inv.inv||'').toLowerCase().includes(f) ||
           (inv.customer||'').toLowerCase().includes(f) ||
           (inv.date||'').toLowerCase().includes(f);
  });
  filtered.forEach(inv => {
    const tr = document.createElement('tr');
    const createdDate = inv.createdAt ? new Date(inv.createdAt).toLocaleDateString('en-IN') : '';
    tr.innerHTML = `<td><strong>${inv.inv}</strong><br><span style="font-size: 11px; color: var(--text-muted);">${createdDate}</span></td>
      <td>${escapeHtml(inv.customer||'Walk-in')}</td>
      <td>${inv.date || ''}</td>
      <td class="text-right"><strong>${fmt(inv.total)}</strong></td>
      <td class="text-center noprint">
        <button class="btn-icon" onclick="printInvoice('${inv.id}')" title="Print">🖨️</button>
        <button class="btn-icon" onclick="openWhatsappModal('${inv.id}')" title="WhatsApp">💬</button>
        <button class="btn-icon" onclick="editInvoice('${inv.id}')" title="Edit">✎</button>
        <button class="btn-icon" onclick="deleteInvoice('${inv.id}')" title="Delete">✕</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

// Print
function printInvoice(id) {
  const invoices = loadJSON(STORAGE_INV, []);
  const inv = invoices.find(i=>i.id === id);
  if(!inv) return alert('Invoice not found');
  const area = $('printArea');
  area.innerHTML = buildInvoiceHTML(inv);
  setTimeout(() => window.print(), 200);
}

function buildInvoiceHTML(inv) {
  const company = {
    name: 'S S TEXTILE',
    gst: '27ABCDE1234F1Z5',
    addr: 'Textile Market, Pune, Maharashtra',
    mobile: '+91 98765 43210',
    bank: 'State Bank of India',
    ac: '1234567890123456',
    ifsc: 'SBIN0001234',
    upi: 'sstextile@upi'
  };

  const itemsHtml = inv.items.map((it) => `
    <tr>
      <td>${escapeHtml(it.name)}</td>
      <td class="text-center">${it.qty}</td>
      <td class="text-right">${fmt(it.rate)}</td>
      <td class="text-right">${fmt(it.qty * it.rate)}</td>
    </tr>`).join('');

  return `
    <div class="invoice-container">
      <div class="invoice-header-section">
        <div class="invoice-company">
          <h1>${company.name}</h1>
          <p>${company.addr}</p>
          <p>Mobile: ${company.mobile}</p>
          <p>GSTIN: ${company.gst}</p>
        </div>
        <div class="invoice-meta">
          <div style="font-size: 18px; font-weight: 800; color: var(--primary);">TAX INVOICE</div>
          <div class="label">Invoice Number</div>
          <div class="value">${inv.inv}</div>
          <div class="label">Invoice Date</div>
          <div class="value">${inv.date}</div>
        </div>
      </div>

      <div class="invoice-bill-section">
        <div class="bill-to">
          <h3>Bill To</h3>
          <p>${escapeHtml(inv.customer || 'Walk-in')}</p>
          <p>${escapeHtml(inv.customerMobile || '')}</p>
        </div>
        <div class="bank-info">
          <h3>Payment Details</h3>
          <p><strong>Bank:</strong> ${company.bank}</p>
          <p><strong>A/C:</strong> ${company.ac}</p>
          <p><strong>IFSC:</strong> ${company.ifsc}</p>
          <p><strong>UPI:</strong> ${company.upi}</p>
        </div>
      </div>

      <table class="invoice-items-table">
        <thead>
          <tr>
            <th>Item & Description</th>
            <th style="width: 80px;" class="text-center">Qty</th>
            <th style="width: 100px;" class="text-right">Rate (₹)</th>
            <th style="width: 120px;" class="text-right">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <div class="invoice-totals">
        <table>
          <tr>
            <th>Subtotal</th>
            <td>${fmt(inv.subtotal)}</td>
          </tr>
          <tr>
            <th>CGST (2.5%)</th>
            <td>${fmt(inv.cgst)}</td>
          </tr>
          <tr>
            <th>SGST (2.5%)</th>
            <td>${fmt(inv.sgst)}</td>
          </tr>
          <tr class="total-row">
            <th>Grand Total</th>
            <td>${fmt(inv.total)}</td>
          </tr>
        </table>
      </div>

      <div class="invoice-terms">
        <strong>Terms & Conditions:</strong> Goods once sold will not be taken back. Subject to Pune jurisdiction. This is a computer-generated invoice.
      </div>

      <div class="invoice-footer">
        <div class="signature-block" style="text-align: left;">
          <h4>Prepared By</h4>
          <p>Authorized Officer</p>
        </div>
        <div class="signature-block" style="text-align: right;">
          <h4>For ${company.name}</h4>
          <p style="margin-top: 30px;">Authorized Signatory</p>
        </div>
      </div>
    </div>
  `;
}

// Helpers
function escapeHtml(s) {
  if(!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// New Invoice
$('newInvoiceBtn').addEventListener('click', () => {
  editingInvoiceId = null;
  items = [];
  renderItems();
  $('invNo').value = nextInvoiceNumber(true);
  $('invDate').value = new Date().toISOString().slice(0,10);
  $('custSelect').value = '';
  $('custMobileSelect').value = '';
  window.scrollTo({top: 0, behavior: 'smooth'});
});

// Export/Import
$('exportBtn').addEventListener('click', () => {
  const meta = loadJSON(STORAGE_META, {});
  const customers = loadJSON(STORAGE_CUST, []);
  const invoices = loadJSON(STORAGE_INV, []);
  const payload = { exportedAt: new Date().toISOString(), meta, customers, invoices };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sst_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
});

$('importFile').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if(!f) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    try {
      const j = JSON.parse(ev.target.result);
      if(!confirm('Import will overwrite local data. Continue?')) return;
      if(j.meta) saveJSON(STORAGE_META, j.meta);
      if(j.customers) saveJSON(STORAGE_CUST, j.customers);
      if(j.invoices) saveJSON(STORAGE_INV, j.invoices);
      initStorage();
      populateCustomerSelect();
      refreshHistory();
      refreshCounts();
      alert('✓ Import complete');
    } catch(err) {
      alert('Invalid JSON file');
    }
  }
  reader.readAsText(f);
  e.target.value = '';
});

// Search
$('searchInvoices').addEventListener('input', (e) => {
  refreshHistory(e.target.value);
});

// Month filter
function populateMonthFilter() {
  const sel = $('filterMonth');
  sel.innerHTML = '<option value="">📅 All months</option>';
  const invoices = loadJSON(STORAGE_INV, []);
  const months = new Set();
  invoices.forEach(inv => {
    if(!inv.date) return;
    const m = inv.date.slice(0,7);
    months.add(m);
  });
  Array.from(months).sort().reverse().forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    sel.appendChild(opt);
  });
}

$('filterMonth').addEventListener('change', (e) => {
  const v = e.target.value;
  if(!v) return refreshHistory($('searchInvoices').value);
  const invoices = loadJSON(STORAGE_INV, []);
  const filtered = invoices.filter(inv => (inv.date || '').startsWith(v));
  const tbody = document.querySelector('#historyTable tbody');
  tbody.innerHTML = '';
  filtered.forEach(inv => {
    const tr = document.createElement('tr');
    const createdDate = inv.createdAt ? new Date(inv.createdAt).toLocaleDateString('en-IN') : '';
    tr.innerHTML = `<td><strong>${inv.inv}</strong><br><span style="font-size: 11px; color: var(--text-muted);">${createdDate}</span></td>
      <td>${escapeHtml(inv.customer||'Walk-in')}</td>
      <td>${inv.date}</td>
      <td class="text-right"><strong>${fmt(inv.total)}</strong></td>
      <td class="text-center noprint">
        <button class="btn-icon" onclick="printInvoice('${inv.id}')">🖨️</button>
        <button class="btn-icon" onclick="openWhatsappModal('${inv.id}')">💬</button>
        <button class="btn-icon" onclick="editInvoice('${inv.id}')">✎</button>
        <button class="btn-icon" onclick="deleteInvoice('${inv.id}')">✕</button>
      </td>`;
    tbody.appendChild(tr);
  });
});

// Print preview
$('printPreviewBtn').addEventListener('click', () => {
  if(items.length === 0) {
    if(!confirm('No items added. Continue?')) return;
  }
  const tempInv = {
    id: 'preview_'+Date.now(),
    inv: $('invNo').value || nextInvoiceNumber(false),
    date: $('invDate').value || new Date().toISOString().slice(0,10),
    customer: $('custSelect').value || 'Walk-in',
    customerMobile: $('custMobileSelect').value || '',
    items: items.slice(),
    subtotal: renderItems().subtotal,
    cgst: renderItems().cgst,
    sgst: renderItems().sgst,
    total: renderItems().grand
  };
  $('printArea').innerHTML = buildInvoiceHTML(tempInv);
  setTimeout(() => window.print(), 200);
});

// Clear form
$('clearFormBtn').addEventListener('click', () => {
  if(items.length > 0 && !confirm('Clear form and lose unsaved items?')) return;
  editingInvoiceId = null;
  $('invNo').value = nextInvoiceNumber(true);
  $('invDate').value = new Date().toISOString().slice(0,10);
  $('custSelect').value = '';
  $('custMobileSelect').value = '';
  $('itemName').value = '';
  $('itemQty').value = '';
  $('itemRate').value = '';
  items = [];
  renderItems();
});

// Help
$('helpBtn').addEventListener('click', () => {
  alert('📘 S S Textile Billing Help\n\n✓ Add customers in the sidebar\n✓ Create invoices with items\n✓ GST calculated automatically (5%)\n✓ Print invoices in professional format\n✓ Share via WhatsApp with one click\n✓ Search and filter invoices\n✓ Backup and import data\n\nAll data stored offline in your browser.');
});

// Startup
function startup() {
  initStorage();
  populateCustomerSelect();
  if(!$('invNo').value) $('invNo').value = nextInvoiceNumber(true);
  if(!$('invDate').value) $('invDate').value = new Date().toISOString().slice(0,10);
  renderItems();
  refreshHistory();
  refreshCounts();
}
startup();

// Global functions
window.editInvoice = editInvoice;
window.printInvoice = printInvoice;
window.deleteInvoice = deleteInvoice;
window.editItem = editItem;
window.removeItem = removeItem;
window.openWhatsappModal = openWhatsappModal;
window.closeWhatsappModal = closeWhatsappModal;

// Close modal on outside click
window.addEventListener('click', (e) => {
  const modal = $('whatsappModal');
  if(e.target === modal) {
    closeWhatsappModal();
  }
});

// Warn on unsaved items
window.addEventListener('beforeunload', function(e) {
  if(items.length > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});
