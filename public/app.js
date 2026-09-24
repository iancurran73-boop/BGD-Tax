'use strict'

// ── API ───────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(path, opts)
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e.error || `HTTP ${res.status}`)
  }
  if (res.status === 204) return null
  return res.json()
}

// ── Constants ─────────────────────────────────────────────────────

const QUARTERS = {
  Q1: { label: 'Q1', period: 'Apr – Jun 2025', months: [4,5,6],   year: 2025 },
  Q2: { label: 'Q2', period: 'Jul – Sep 2025', months: [7,8,9],   year: 2025 },
  Q3: { label: 'Q3', period: 'Oct – Dec 2025', months: [10,11,12], year: 2025 },
  Q4: { label: 'Q4', period: 'Jan – Mar 2026', months: [1,2,3],   year: 2026 },
}

const INCOME_CATS = {
  turnover:     'Income from jobs / labour',
  materials_charged: 'Materials charged to customers',
  other_income: 'Other business income',
}

const EXPENSE_CATS = {
  materials:       'Materials and supplies',
  tools:           'Tools and equipment',
  travel:          'Van, fuel and travel expenses',
  subcontractors:  'Payments to subcontractors',
  wages:           'Wages and staff costs',
  premises:        'Premises and workshop costs',
  insurance:       'Insurance (van, public liability)',
  phone_admin:     'Phone, internet and admin costs',
  advertising:     'Advertising and marketing',
  professional_fees: 'Accountancy and professional fees',
  bank_charges:    'Bank charges and interest',
  other_expenses:  'Other allowable expenses',
}

const ALL_CATS = { ...INCOME_CATS, ...EXPENSE_CATS }

const PAY_METHODS = { cash: 'Cash', bank: 'Bank transfer', cheque: 'Cheque' }

const NAV = [
  { id: 'overview',  ic: 'ti-layout-dashboard', lb: 'Overview',    mob: 'Home'    },
  { id: 'Q1',        ic: 'ti-calendar-month',   lb: 'Q1 Apr–Jun',  mob: 'Q1'      },
  { id: 'Q2',        ic: 'ti-calendar-month',   lb: 'Q2 Jul–Sep',  mob: 'Q2'      },
  { id: 'Q3',        ic: 'ti-calendar-month',   lb: 'Q3 Oct–Dec',  mob: 'Q3'      },
  { id: 'Q4',        ic: 'ti-calendar-month',   lb: 'Q4 Jan–Mar',  mob: 'Q4'      },
  { id: 'mileage',   ic: 'ti-steering-wheel',   lb: 'Mileage',     mob: 'Miles'   },
  { id: 'taxreturn', ic: 'ti-file-invoice',     lb: 'Tax Return',  mob: 'Tax'     },
]

// HMRC approved mileage rates 2025/26
const MILEAGE_RATES = { low: 0.45, high: 0.25, threshold: 10000 }

// ── State ─────────────────────────────────────────────────────────

let S = {
  view: 'overview',
  txs:  [],
  mileage: [],
  loading: true,
  addForm: false,
  addMileage: false,
  filterDir: 'all',
  filterCat: 'all',
  search: '',
  confirmClear: null,
  csvImport: false,
  csvRows: [],
  csvMapped: null,
}

// ── Helpers ───────────────────────────────────────────────────────

const fmt  = n  => '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const uid  = () => Math.random().toString(36).slice(2,7)
const tod  = () => new Date().toISOString().split('T')[0]
const fd   = d  => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : '—'
const fds  = d  => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short' }) : '—'
const g    = id => document.getElementById(id)
const v    = id => { const e = g(id); return e ? e.value.trim() : '' }
const fv   = id => parseFloat(v(id)) || 0
const bdg  = (cls, txt) => `<span class="bdg ${cls}">${txt}</span>`
const pmBdg = m => ({ cash:'b-cs', bank:'b-bk', cheque:'b-ch' }[m] || 'b-ch')

function dateToQ(d) {
  const m = parseInt(d.split('-')[1])
  const y = parseInt(d.split('-')[0])
  if (m >= 4 && m <= 6  && y === 2025) return 'Q1'
  if (m >= 7 && m <= 9  && y === 2025) return 'Q2'
  if (m >= 10 && m <= 12 && y === 2025) return 'Q3'
  if (m >= 1 && m <= 3  && y === 2026) return 'Q4'
  return null
}

function showToast(msg, ok = true) {
  const t = document.createElement('div')
  t.style.cssText = `position:fixed;bottom:70px;right:16px;padding:10px 16px;border-radius:8px;font-size:13px;z-index:9999;color:#fff;background:${ok ? '#059669' : '#DC2626'};font-family:inherit;box-shadow:0 4px 12px rgba(0,0,0,0.15)`
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 3000)
}

function qTotals(quarter) {
  const rows = quarter ? S.txs.filter(t => t.quarter === quarter) : S.txs
  const income  = rows.filter(t => t.direction === 'income').reduce((s,t) => s + Number(t.amount), 0)
  const expense = rows.filter(t => t.direction === 'expense').reduce((s,t) => s + Number(t.amount), 0)
  return { income, expense, profit: income - expense, count: rows.length }
}

// ── Tax calculation (2025/26) ─────────────────────────────────────

function calcTax(netProfit) {
  if (netProfit <= 0) return { netProfit: 0, taxableIncome: 0, basicBand: 0, higherBand: 0, additionalBand: 0, incomeTax: 0, ni: 0, total: 0, poa: 0 }

  const PA  = 12570  // Personal allowance
  const BRL = 50270  // Basic rate limit (total income)
  const HRL = 125140 // Higher rate limit

  // Personal allowance taper (reduced £1 per £2 over £100k)
  let pa = PA
  if (netProfit > 100000) pa = Math.max(0, PA - Math.floor((netProfit - 100000) / 2))

  const taxableIncome = Math.max(0, netProfit - pa)
  const basicBand     = Math.max(0, Math.min(taxableIncome, BRL - PA))
  const higherBand    = Math.max(0, Math.min(taxableIncome - basicBand, HRL - BRL))
  const additionalBand = Math.max(0, taxableIncome - basicBand - higherBand)

  const incomeTax = basicBand * 0.20 + higherBand * 0.40 + additionalBand * 0.45

  // Class 4 NI: 6% on £12,570–£50,270; 2% above
  let ni = 0
  if (netProfit > 12570) {
    const mainBand = Math.min(netProfit - 12570, 50270 - 12570)
    ni += mainBand * 0.06
    if (netProfit > 50270) ni += (netProfit - 50270) * 0.02
  }

  const total = incomeTax + ni
  const poa   = total / 2  // Payment on account = 50% of bill

  return {
    netProfit,
    pa,
    taxableIncome: Math.round(taxableIncome * 100) / 100,
    basicBand:     Math.round(basicBand     * 100) / 100,
    higherBand:    Math.round(higherBand    * 100) / 100,
    additionalBand:Math.round(additionalBand* 100) / 100,
    incomeTax:     Math.round(incomeTax     * 100) / 100,
    ni:            Math.round(ni            * 100) / 100,
    total:         Math.round(total         * 100) / 100,
    poa:           Math.round(poa           * 100) / 100,
  }
}

// ── Load data ─────────────────────────────────────────────────────

async function loadAll() {
  S.loading = true
  rMain()
  try {
    const [txs, mileage] = await Promise.all([
      api('GET', '/api/transactions'),
      api('GET', '/api/mileage').catch(() => []),
    ])
    S.txs     = txs
    S.mileage = mileage
    S.loading = false
    rMain()
  } catch (err) {
    const el = g('main')
    if (el) el.innerHTML = `<div style="padding:60px;text-align:center;color:#DC2626;font-family:inherit">
      Failed to load: ${err.message}<br><br>
      <button onclick="loadAll()" style="padding:8px 16px;background:#D97706;color:#fff;border:none;border-radius:7px;cursor:pointer;font-family:inherit">Retry</button>
    </div>`
  }
}

// ── Navigation ────────────────────────────────────────────────────

function rNav() {
  const el = g('sbNav')
  if (el) el.innerHTML = NAV.map(n =>
    `<button class="sbi${S.view===n.id?' on':''}" onclick="go('${n.id}')"><i class="ti ${n.ic}" aria-hidden="true"></i>${n.lb}</button>`
  ).join('')
  const mn = g('mobNav')
  if (mn) mn.innerHTML = NAV.map(n =>
    `<button class="mnb${S.view===n.id?' on':''}" onclick="go('${n.id}')"><i class="ti ${n.ic}" aria-hidden="true"></i>${n.mob}</button>`
  ).join('')
}

function go(view) {
  S.view = view
  S.addForm = S.addMileage = S.csvImport = false
  S.editId  = S.confirmClear = null
  S.csvRows = []; S.csvMapped = null
  S.filterDir = 'all'; S.filterCat = 'all'; S.search = ''
  rNav(); rMain()
}

function rMain() {
  const el = g('main')
  if (!el) return
  if (S.loading) {
    el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:300px;color:#94A3B8;font-size:13px">Loading…</div>'
    return
  }
  const views = { overview: rOverview, Q1: () => rQuarter('Q1'), Q2: () => rQuarter('Q2'), Q3: () => rQuarter('Q3'), Q4: () => rQuarter('Q4'), mileage: rMileage, taxreturn: rTaxReturn }
  el.innerHTML = (views[S.view] || rOverview)()
}

// ── Overview ──────────────────────────────────────────────────────

function rOverview() {
  const yr  = qTotals(null)
  const qs  = Object.keys(QUARTERS).map(q => ({ q, ...qTotals(q) }))
  const tax = calcTax(Math.max(0, yr.profit))

  return `
  <div class="ph">
    <div class="ph-row">
      <div><div class="pt">Hi Brian 👋</div><div class="ps">Tax year 2025/26 — 6 Apr 2025 to 5 Apr 2026</div></div>
      <button class="btn btn-outline" onclick="doExport('all')"><i class="ti ti-download" aria-hidden="true"></i>Export all CSV</button>
    </div>
  </div>
  <div class="pb">
    <div class="sg">
      <div class="sc green"><div class="sl">Total income</div><div class="sv">${fmt(yr.income)}</div><div class="ss">${S.txs.filter(t=>t.direction==='income').length} entries</div></div>
      <div class="sc red">  <div class="sl">Total expenses</div><div class="sv">${fmt(yr.expense)}</div><div class="ss">${S.txs.filter(t=>t.direction==='expense').length} entries</div></div>
      <div class="sc ${yr.profit>=0?'green':'red'}"><div class="sl">Net profit</div><div class="sv">${fmt(yr.profit)}</div><div class="ss">before tax</div></div>
      <div class="sc amber"><div class="sl">Est. tax bill</div><div class="sv">${fmt(tax.total)}</div><div class="ss">income tax + NI</div></div>
    </div>

    <div class="year-grid">
      ${qs.map(({q,income,expense,profit,count}) => `
      <div class="yq" onclick="go('${q}')" style="cursor:pointer">
        <div class="yq-label">${q} · ${QUARTERS[q].period}</div>
        <div class="yq-row"><span class="lbl">Income</span><span class="val g">${fmt(income)}</span></div>
        <div class="yq-row"><span class="lbl">Expenses</span><span class="val r">${fmt(expense)}</span></div>
        <div class="yq-row"><span class="lbl">Profit</span><span class="val ${profit>=0?'g':'r'}">${fmt(profit)}</span></div>
        <div style="font-size:10.5px;color:#94A3B8;margin-top:6px">${count} transaction${count===1?'':'s'}</div>
      </div>`).join('')}
    </div>

    <div class="card">
      <div class="ch">
        <span class="ct">Category breakdown — full year</span>
        <button class="btn btn-outline btn-sm" onclick="go('taxreturn')"><i class="ti ti-file-invoice" aria-hidden="true"></i>Tax return</button>
      </div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th style="width:40%">Category</th><th style="width:15%">Direction</th>${Object.keys(QUARTERS).map(q=>`<th style="width:11%">${q}</th>`).join('')}<th style="width:12%">Total</th></tr></thead>
        <tbody>
        ${Object.entries(ALL_CATS).map(([cat, label]) => {
          const dir = INCOME_CATS[cat] ? 'income' : 'expense'
          const qAmts = Object.keys(QUARTERS).map(q =>
            S.txs.filter(t=>t.quarter===q&&t.category===cat).reduce((s,t)=>s+Number(t.amount),0)
          )
          const total = qAmts.reduce((s,n)=>s+n,0)
          if (!total) return ''
          return `<tr>
            <td class="fw">${label}</td>
            <td>${bdg(dir==='income'?'b-in':'b-ex',dir)}</td>
            ${qAmts.map(a=>`<td>${a?fmt(a):'—'}</td>`).join('')}
            <td class="fw">${fmt(total)}</td>
          </tr>`
        }).join('')}
        </tbody>
      </table></div>
    </div>
  </div>`
}

// ── Quarter view ──────────────────────────────────────────────────

function rQuarter(q) {
  const info = QUARTERS[q]
  let rows = S.txs.filter(t => t.quarter === q)
  if (S.filterDir !== 'all') rows = rows.filter(t => t.direction === S.filterDir)
  if (S.filterCat !== 'all') rows = rows.filter(t => t.category === S.filterCat)
  if (S.search) {
    const srch = S.search.toLowerCase()
    rows = rows.filter(t => t.description.toLowerCase().includes(srch) || (t.notes||'').toLowerCase().includes(srch))
  }
  const tots = qTotals(q)

  return `
  <div class="ph">
    <div class="ph-row">
      <div><div class="pt">${info.label} — ${info.period}</div><div class="ps">${tots.count} transactions</div></div>
      <div style="display:flex;gap:7px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="S.addForm=!S.addForm;S.csvImport=false;rMain()"><i class="ti ti-plus" aria-hidden="true"></i>Add</button>
        <label class="btn btn-outline" style="cursor:pointer"><i class="ti ti-upload" aria-hidden="true"></i>Import CSV<input type="file" accept=".csv" style="display:none" onchange="handleCsvUpload(this,'${q}')"></label>
        <button class="btn btn-outline" onclick="doExport('${q}')"><i class="ti ti-download" aria-hidden="true"></i>Export</button>
        <button class="btn btn-danger btn-sm" onclick="confirmClear('${q}')"><i class="ti ti-trash" aria-hidden="true"></i>Clear ${q}</button>
      </div>
    </div>
  </div>

  <div class="q-bar">
    <div class="q-bar-item green"><div class="ql">Income</div><div class="qv">${fmt(tots.income)}</div></div>
    <div class="q-bar-item red"><div class="ql">Expenses</div><div class="qv">${fmt(tots.expense)}</div></div>
    <div class="q-bar-item ${tots.profit>=0?'amber':'red'}"><div class="ql">Net profit</div><div class="qv">${fmt(tots.profit)}</div></div>
  </div>

  ${S.confirmClear===q ? `<div style="margin:12px 24px;padding:14px 16px;background:#FEE2E2;border:1px solid #FCA5A5;border-radius:8px">
    <div style="font-size:13px;font-weight:500;color:#DC2626;margin-bottom:8px">Delete all ${q} transactions? This cannot be undone.</div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-danger" onclick="doClear('${q}')"><i class="ti ti-trash" aria-hidden="true"></i>Yes, delete all</button>
      <button class="btn btn-outline" onclick="S.confirmClear=null;rMain()">Cancel</button>
    </div>
  </div>` : ''}

  ${S.csvImport ? rCsvPreview(q) : ''}
  ${S.addForm ? rAddForm(q) : ''}

  <div class="cr">
    <div class="sbox"><i class="ti ti-search" style="font-size:12px;color:#94A3B8" aria-hidden="true"></i><input type="text" placeholder="Search…" value="${S.search}" oninput="S.search=this.value;rMain()"></div>
    <select class="sel" onchange="S.filterDir=this.value;rMain()">
      <option value="all"${S.filterDir==='all'?' selected':''}>All</option>
      <option value="income"${S.filterDir==='income'?' selected':''}>Income</option>
      <option value="expense"${S.filterDir==='expense'?' selected':''}>Expenses</option>
    </select>
    <select class="sel" onchange="S.filterCat=this.value;rMain()">
      <option value="all"${S.filterCat==='all'?' selected':''}>All categories</option>
      <optgroup label="Income">${Object.entries(INCOME_CATS).map(([k,l])=>`<option value="${k}"${S.filterCat===k?' selected':''}>${l}</option>`).join('')}</optgroup>
      <optgroup label="Expenses">${Object.entries(EXPENSE_CATS).map(([k,l])=>`<option value="${k}"${S.filterCat===k?' selected':''}>${l}</option>`).join('')}</optgroup>
    </select>
  </div>

  <div class="card" style="margin:0;border-radius:0;border-left:none;border-right:none">
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr>
        <th style="width:12%">Date</th>
        <th style="width:28%">Description</th>
        <th style="width:20%">Category</th>
        <th style="width:10%">Method</th>
        <th style="width:12%">Amount</th>
        <th style="width:11%">Direction</th>
        <th style="width:7%"></th>
      </tr></thead>
      <tbody>
      ${rows.length ? rows.map(t => `<tr>
        <td class="xs mu">${fds(t.transaction_date)}</td>
        <td class="fw">${t.description}${t.notes?`<div class="xs mu" style="font-weight:400">${t.notes}</div>`:''}</td>
        <td class="xs mu">${ALL_CATS[t.category]||t.category}</td>
        <td>${bdg(pmBdg(t.pay_method), PAY_METHODS[t.pay_method]||t.pay_method)}</td>
        <td class="fw">${fmt(t.amount)}</td>
        <td>${bdg(t.direction==='income'?'b-in':'b-ex',t.direction)}</td>
        <td><button class="del-btn" onclick="delTx('${t.id}')" title="Delete"><i class="ti ti-trash" aria-hidden="true"></i></button></td>
      </tr>`).join('') : `<tr><td colspan="7" class="empty">No transactions${S.filterDir!=='all'||S.filterCat!=='all'||S.search?' matching your filters':''}. Use the Add button to get started.</td></tr>`}
      </tbody>
    </table></div>
  </div>`
}

function rAddForm(q) {
  const info = QUARTERS[q]
  const defaultDate = (() => {
    const d = new Date()
    const m = d.getMonth() + 1, y = d.getFullYear()
    const inQ = info.months.includes(m) && (info.year === y || (info.label==='Q4' && y===2026 && m<=3))
    return inQ ? tod() : `${info.year}-${String(info.months[0]).padStart(2,'0')}-01`
  })()
  return `
  <div class="iform">
    <div class="fg">
      <div><label>Date</label><input type="date" id="af-dt" value="${defaultDate}" max="2026-04-05"></div>
      <div><label>Description</label><input type="text" id="af-de" placeholder="e.g. Plumbing materials — 14 Oak Street"></div>
      <div><label>Amount (£)</label><input type="number" id="af-am" step="0.01" min="0" placeholder="0.00"></div>
      <div><label>Direction</label><select id="af-di" onchange="rAddCats()"><option value="income">Income</option><option value="expense" selected>Expense</option></select></div>
      <div><label>Category</label><select id="af-ca">${rCatOptions('expense')}</select></div>
      <div><label>Payment method</label><select id="af-pm"><option value="cash">Cash</option><option value="bank" selected>Bank transfer</option><option value="cheque">Cheque</option></select></div>
      <div class="s2"><label>Notes / reference (optional)</label><input type="text" id="af-no" placeholder="Invoice ref, customer name, job address…"></div>
    </div>
    <div class="frow">
      <button class="btn btn-primary" onclick="doAdd('${q}')"><i class="ti ti-check" aria-hidden="true"></i>Save transaction</button>
      <button class="btn btn-outline" onclick="S.addForm=false;rMain()">Cancel</button>
    </div>
  </div>`
}

function rCatOptions(dir) {
  const cats = dir === 'income' ? INCOME_CATS : EXPENSE_CATS
  return Object.entries(cats).map(([k,l]) => `<option value="${k}">${l}</option>`).join('')
}

function rAddCats() {
  const dirEl = g('af-di')
  const catEl = g('af-ca')
  if (dirEl && catEl) catEl.innerHTML = rCatOptions(dirEl.value)
}

// ── Tax return ────────────────────────────────────────────────────

function rTaxReturn() {
  const yr  = qTotals(null)
  const net = Math.max(0, yr.profit)
  const t   = calcTax(net)
  const qs  = Object.keys(QUARTERS)

  const catBreakdown = (dir) => Object.entries(dir === 'income' ? INCOME_CATS : EXPENSE_CATS)
    .map(([cat, label]) => {
      const total = S.txs.filter(tx => tx.category === cat).reduce((s,tx) => s + Number(tx.amount), 0)
      return total ? `<div class="tax-row"><div class="tax-label">${label}</div><div class="tax-value">${fmt(total)}</div></div>` : ''
    }).join('')

  return `
  <div class="ph">
    <div class="ph-row">
      <div><div class="pt">Tax Return 2025/26</div><div class="ps">Self Assessment estimate — sole trader</div></div>
      <button class="btn btn-outline" onclick="exportTaxSummary()"><i class="ti ti-download" aria-hidden="true"></i>Export summary</button>
    </div>
  </div>
  <div class="tax-section">

    <div class="disclaimer">
      <strong>Estimate only.</strong> These figures are calculated from the transactions you have entered. Always confirm your Self Assessment return with a qualified accountant before submitting to HMRC. Figures do not include pension contributions, other income sources, payments on account already made, or any prior year adjustments.
    </div>

    <div class="tax-card">
      <div class="tax-header">Income</div>
      ${catBreakdown('income')}
      <div class="tax-row total green-bg"><div class="tax-label"><strong>Total income</strong></div><div class="tax-value green"><strong>${fmt(yr.income)}</strong></div></div>
    </div>

    <div class="tax-card">
      <div class="tax-header">Allowable expenses</div>
      ${catBreakdown('expense')}
      <div class="tax-row total red-bg"><div class="tax-label"><strong>Total expenses</strong></div><div class="tax-value red"><strong>${fmt(yr.expense)}</strong></div></div>
    </div>

    <div class="tax-card">
      <div class="tax-header">Net profit</div>
      <div class="tax-row"><div class="tax-label">Total income<small>from above</small></div><div class="tax-value green">${fmt(yr.income)}</div></div>
      <div class="tax-row"><div class="tax-label">Less: total expenses<small>from above</small></div><div class="tax-value red">(${fmt(yr.expense)})</div></div>
      <div class="tax-row total highlight"><div class="tax-label"><strong>Net profit before tax</strong></div><div class="tax-value amber"><strong>${fmt(net)}</strong></div></div>
    </div>

    <div class="tax-card">
      <div class="tax-header">Income Tax — 2025/26 rates</div>
      <div class="tax-row"><div class="tax-label">Net profit<small>trading income</small></div><div class="tax-value">${fmt(net)}</div></div>
      <div class="tax-row"><div class="tax-label">Less: Personal Allowance<small>${net > 100000 ? 'tapered — income over £100,000' : 'standard 2025/26'}</small></div><div class="tax-value">(${fmt(t.pa)})</div></div>
      <div class="tax-row"><div class="tax-label">Taxable income</div><div class="tax-value">${fmt(t.taxableIncome)}</div></div>
      ${t.basicBand > 0 ? `<div class="tax-row"><div class="tax-label">Basic rate band<small>${fmt(t.basicBand)} @ 20%</small></div><div class="tax-value">${fmt(t.basicBand * 0.20)}</div></div>` : ''}
      ${t.higherBand > 0 ? `<div class="tax-row"><div class="tax-label">Higher rate band<small>${fmt(t.higherBand)} @ 40%</small></div><div class="tax-value">${fmt(t.higherBand * 0.40)}</div></div>` : ''}
      ${t.additionalBand > 0 ? `<div class="tax-row"><div class="tax-label">Additional rate band<small>${fmt(t.additionalBand)} @ 45%</small></div><div class="tax-value">${fmt(t.additionalBand * 0.45)}</div></div>` : ''}
      <div class="tax-row total"><div class="tax-label"><strong>Income tax</strong></div><div class="tax-value"><strong>${fmt(t.incomeTax)}</strong></div></div>
    </div>

    <div class="tax-card">
      <div class="tax-header">Class 4 National Insurance — 2025/26 rates</div>
      <div class="tax-row"><div class="tax-label">Net profit</div><div class="tax-value">${fmt(net)}</div></div>
      <div class="tax-row"><div class="tax-label">Below Lower Profits Limit<small>£12,570 @ 0%</small></div><div class="tax-value">£0.00</div></div>
      ${net > 12570 ? `<div class="tax-row"><div class="tax-label">Main rate band<small>${fmt(Math.min(net-12570,50270-12570))} @ 6%</small></div><div class="tax-value">${fmt(Math.min(net-12570,50270-12570)*0.06)}</div></div>` : ''}
      ${net > 50270 ? `<div class="tax-row"><div class="tax-label">Upper rate band<small>${fmt(net-50270)} @ 2%</small></div><div class="tax-value">${fmt((net-50270)*0.02)}</div></div>` : ''}
      <div class="tax-row total"><div class="tax-label"><strong>Class 4 NI</strong></div><div class="tax-value"><strong>${fmt(t.ni)}</strong></div></div>
      <div class="tax-row" style="background:var(--surface)"><div class="tax-label" style="font-size:11px;color:#94A3B8">Class 2 NI</div><div class="tax-value" style="font-size:11px;color:#94A3B8">Abolished April 2024 — not applicable</div></div>
    </div>

    <div class="tax-card">
      <div class="tax-header">Total liability and payment schedule</div>
      <div class="tax-row"><div class="tax-label">Income tax</div><div class="tax-value">${fmt(t.incomeTax)}</div></div>
      <div class="tax-row"><div class="tax-label">Class 4 NI</div><div class="tax-value">${fmt(t.ni)}</div></div>
      <div class="tax-row total highlight"><div class="tax-label"><strong>Total estimated tax bill</strong></div><div class="tax-value amber"><strong>${fmt(t.total)}</strong></div></div>
      <div class="tax-row"><div class="tax-label">Less: payments on account already made<small>deduct any POA paid Jan 2026 + Jul 2026</small></div><div class="tax-value" style="color:#94A3B8">—</div></div>
      <div style="padding:10px 18px;background:var(--surface);border-top:1px solid var(--border)">
        <div style="font-size:12px;font-weight:600;color:var(--text-mid);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Payment dates</div>
        <div style="display:grid;gap:6px">
          <div style="display:flex;justify-content:space-between;font-size:12.5px"><span style="color:var(--text-mid)">31 Jan 2027 — balancing payment for 25/26</span><span style="font-weight:500">Balance due</span></div>
          <div style="display:flex;justify-content:space-between;font-size:12.5px"><span style="color:var(--text-mid)">31 Jan 2027 — 1st POA for 26/27 (50% of bill)</span><span style="font-weight:500">${fmt(t.poa)}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:12.5px"><span style="color:var(--text-mid)">31 Jul 2027 — 2nd POA for 26/27 (50% of bill)</span><span style="font-weight:500">${fmt(t.poa)}</span></div>
        </div>
      </div>
    </div>

    <div class="tax-card">
      <div class="tax-header">Quarterly summary — MTD filing reference</div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Quarter</th><th>Period</th><th>Income</th><th>Expenses</th><th>Profit</th><th>Entries</th></tr></thead>
        <tbody>
        ${qs.map(q => {
          const tot = qTotals(q)
          return `<tr>
            <td class="fw">${q}</td>
            <td class="xs mu">${QUARTERS[q].period}</td>
            <td style="color:var(--green);font-weight:500">${fmt(tot.income)}</td>
            <td style="color:var(--red);font-weight:500">${fmt(tot.expense)}</td>
            <td style="font-weight:600;color:${tot.profit>=0?'var(--amber)':'var(--red)'}">${fmt(tot.profit)}</td>
            <td class="xs mu">${tot.count}</td>
          </tr>`
        }).join('')}
        <tr style="background:var(--surface)">
          <td class="fw" colspan="2">Full year</td>
          <td style="color:var(--green);font-weight:600">${fmt(yr.income)}</td>
          <td style="color:var(--red);font-weight:600">${fmt(yr.expense)}</td>
          <td style="font-weight:700;color:${yr.profit>=0?'var(--amber)':'var(--red)'}">${fmt(yr.profit)}</td>
          <td class="xs mu">${yr.count}</td>
        </tr>
        </tbody>
      </table></div>
    </div>

  </div>`
}

// ── Mileage view ──────────────────────────────────────────────────

function calcMileage(logs) {
  let cumMiles = 0, totalClaim = 0
  const detailed = logs.map(m => {
    const miles = Number(m.miles)
    const before = cumMiles; cumMiles += miles
    let claim = 0
    if (before >= MILEAGE_RATES.threshold) {
      claim = miles * MILEAGE_RATES.high
    } else if (cumMiles > MILEAGE_RATES.threshold) {
      claim = (MILEAGE_RATES.threshold - before) * MILEAGE_RATES.low + (cumMiles - MILEAGE_RATES.threshold) * MILEAGE_RATES.high
    } else {
      claim = miles * MILEAGE_RATES.low
    }
    totalClaim += claim
    return { ...m, miles, claim: Math.round(claim * 100) / 100 }
  })
  return { detailed, totalMiles: cumMiles, totalClaim: Math.round(totalClaim * 100) / 100 }
}

function rMileage() {
  const sorted = [...S.mileage].sort((a,b) => a.journey_date.localeCompare(b.journey_date))
  const { detailed, totalMiles, totalClaim } = calcMileage(sorted)
  const pct = Math.min(100, (totalMiles / MILEAGE_RATES.threshold) * 100)
  const over = totalMiles > MILEAGE_RATES.threshold

  const qBreak = ['Q1','Q2','Q3','Q4'].map(q => {
    const preLogs  = sorted.filter(m => m.quarter < q)
    const thisLogs = sorted.filter(m => m.quarter === q)
    const qMiles   = thisLogs.reduce((s,m) => s + Number(m.miles), 0)
    const { totalClaim: preClaim } = calcMileage(preLogs)
    const { totalClaim: combined } = calcMileage([...preLogs, ...thisLogs])
    return { q, miles: qMiles, claim: Math.round((combined - preClaim) * 100) / 100 }
  })

  return `
  <div class="ph">
    <div class="ph-row">
      <div><div class="pt">Mileage Log</div><div class="ps">HMRC approved rates 2025/26 · 45p/mile (first 10,000) · 25p/mile above</div></div>
      <div style="display:flex;gap:7px">
        <button class="btn btn-primary" onclick="S.addMileage=!S.addMileage;rMain()"><i class="ti ti-plus" aria-hidden="true"></i>Add journey</button>
        <button class="btn btn-outline" onclick="exportMileage()"><i class="ti ti-download" aria-hidden="true"></i>Export</button>
      </div>
    </div>
  </div>

  <div style="padding:14px 24px;background:#fff;border-bottom:1px solid var(--border)">
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
      <div class="sc"><div class="sl">Total miles</div><div class="sv">${totalMiles.toLocaleString('en-GB',{maximumFractionDigits:1})}</div><div class="ss">of 10,000 threshold</div></div>
      <div class="sc ${over?'amber':'green'}"><div class="sl">Total claimable</div><div class="sv">${fmt(totalClaim)}</div><div class="ss">${over?'mixed rate (45p/25p)':'at 45p per mile'}</div></div>
      <div class="sc"><div class="sl">Rate</div><div class="sv" style="font-size:15px">${over?'Mixed':'45p/mile'}</div><div class="ss">${over?`${(totalMiles-10000).toFixed(0)} miles at 25p`:'below 10,000 threshold'}</div></div>
    </div>
    <div style="margin-bottom:5px;display:flex;justify-content:space-between;font-size:11px;color:var(--text-lt)">
      <span>${totalMiles.toFixed(0)} miles driven</span><span>10,000 mile threshold</span>
    </div>
    <div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden">
      <div style="height:100%;width:${pct}%;background:${pct>=100?'var(--amber)':'var(--green)'};border-radius:4px"></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px">
      ${qBreak.map(({q,miles,claim}) => `<div style="padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:7px">
        <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-lt);margin-bottom:3px">${q}</div>
        <div style="font-size:13px;font-weight:500">${miles.toFixed(0)} mi</div>
        <div style="font-size:11px;color:var(--green);margin-top:1px">${fmt(claim)}</div>
      </div>`).join('')}
    </div>
  </div>

  ${S.addMileage ? `<div class="iform">
    <div class="fg">
      <div><label>Date</label><input type="date" id="ml-dt" value="${tod()}" max="2026-04-05"></div>
      <div><label>Quarter</label><select id="ml-q"><option value="Q1">Q1 Apr–Jun 2025</option><option value="Q2">Q2 Jul–Sep 2025</option><option value="Q3">Q3 Oct–Dec 2025</option><option value="Q4" selected>Q4 Jan–Mar 2026</option></select></div>
      <div><label>From</label><input type="text" id="ml-fr" placeholder="Home / Gateshead"></div>
      <div><label>To</label><input type="text" id="ml-to" placeholder="Customer address or job site"></div>
      <div><label>Miles</label><input type="number" id="ml-mi" step="0.1" min="0.1" placeholder="0.0"></div>
      <div><label>Purpose</label><input type="text" id="ml-pu" placeholder="e.g. Bathroom refit — 14 Oak Street"></div>
      <div class="s2"><label>Notes</label><input type="text" id="ml-no"></div>
    </div>
    <div class="frow">
      <button class="btn btn-primary" onclick="addMileageJourney()"><i class="ti ti-check" aria-hidden="true"></i>Save journey</button>
      <button class="btn btn-outline" onclick="S.addMileage=false;rMain()">Cancel</button>
    </div>
  </div>` : ''}

  <div style="padding:12px 24px">
    <div class="card" style="margin-bottom:12px">
      <div class="ch"><span class="ct">Journey log</span><span class="xs mu">${sorted.length} journeys · ${totalMiles.toFixed(1)} miles</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th style="width:11%">Date</th><th style="width:14%">From</th><th style="width:14%">To</th><th style="width:26%">Purpose</th><th style="width:6%">Q</th><th style="width:7%">Miles</th><th style="width:9%">Claim</th><th style="width:7%">Rate</th><th style="width:6%"></th></tr></thead>
        <tbody>
        ${detailed.length ? detailed.map(m => `<tr>
          <td class="xs mu">${fds(m.journey_date)}</td>
          <td class="xs mu">${m.from_location||'—'}</td>
          <td class="xs mu">${m.to_location||'—'}</td>
          <td class="fw xs">${m.purpose}</td>
          <td>${bdg('b-rv',m.quarter)}</td>
          <td class="fw">${m.miles}</td>
          <td class="fw" style="color:var(--green)">${fmt(m.claim)}</td>
          <td class="xs mu">${m.claim/m.miles >= 0.44?'45p':'25p'}</td>
          <td><button class="del-btn" onclick="delMileage('${m.id}')"><i class="ti ti-trash" aria-hidden="true"></i></button></td>
        </tr>`).join('') : '<tr><td colspan="9" class="empty">No journeys yet — add your first journey above.</td></tr>'}
        </tbody>
      </table></div>
      ${detailed.length ? `<div style="padding:9px 14px;background:var(--surface);border-top:1px solid var(--border);display:flex;justify-content:space-between;font-size:12.5px"><span style="color:var(--text-mid)">Total: ${totalMiles.toFixed(1)} miles</span><span style="font-weight:600;color:var(--green)">${fmt(totalClaim)} claimable</span></div>` : ''}
    </div>

    <div class="card">
      <div class="ch"><span class="ct">Add mileage claim to MTD</span><span class="xs mu">Creates a travel expense entry per quarter</span></div>
      ${qBreak.filter(b => b.claim > 0).length ? qBreak.filter(b => b.claim > 0).map(({q,miles,claim}) =>
        `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--border)">
          <div><div class="fw xs">${q} — ${miles.toFixed(0)} miles</div><div class="xs mu">HMRC mileage claim</div></div>
          <div style="display:flex;align-items:center;gap:10px"><span class="fw" style="color:var(--green)">${fmt(claim)}</span><button class="btn btn-primary btn-sm" onclick="addMileageToMTD('${q}',${claim})"><i class="ti ti-plus" aria-hidden="true"></i>Add to ${q}</button></div>
        </div>`).join('')
      : '<div class="empty">Log journeys above then add the claim to your quarterly MTD records.</div>'}
    </div>
  </div>`
}

// ── CSV Import ────────────────────────────────────────────────────

function handleCsvUpload(inp, defaultQ) {
  const f = inp.files[0]; if (!f) return
  const r = new FileReader()
  r.onload = e => {
    const rows = parseCsvImport(e.target.result, defaultQ)
    if (!rows.length) return showToast('No valid rows found in CSV', false)
    S.csvRows   = rows
    S.csvImport = true
    S.addForm   = false
    rMain()
  }
  r.readAsText(f)
}

function splitCsvLine(line) {
  const result = []; let cur = ''; let inQ = false
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"' && !inQ) { inQ = true }
    else if (line[i] === '"' && inQ) { inQ = false }
    else if (line[i] === ',' && !inQ) { result.push(cur); cur = '' }
    else { cur += line[i] }
  }
  result.push(cur)
  return result
}

function parseCsvImport(text, defaultQ) {
  const lines = text.replace(/^\uFEFF/,'').replace(/\r/g,'').split('\n').filter(l => l.trim() && !l.startsWith('#'))
  if (lines.length < 2) return []
  const header = lines[0].split(',').map(h => h.replace(/['"]/g,'').trim().toLowerCase())
  const col = name => header.findIndex(h => h.includes(name))
  const get = (parts, name) => (parts[col(name)] || '').replace(/^"|"$/g,'').trim()
  const dupKey = new Set(S.txs.map(t => t.transaction_date + '_' + t.amount + '_' + t.description.slice(0,20)))
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const parts = splitCsvLine(lines[i])
    if (parts.length < 3) continue
    const date = get(parts,'date')
    const desc = get(parts,'description') || get(parts,'desc')
    const amtRaw = get(parts,'amount')
    const amt = parseFloat(amtRaw.replace(/[^0-9.]/g,''))
    if (!date || !desc || isNaN(amt) || amt <= 0) continue
    const include = get(parts,'include').toUpperCase()
    if (include === 'NO') continue
    const direction = (get(parts,'direction') || get(parts,'dir') || 'expense').toLowerCase()
    const category  = get(parts,'category') || (direction === 'income' ? 'turnover' : 'other_expenses')
    const quarter   = get(parts,'quarter') || defaultQ || dateToQ(date) || 'Q1'
    const payMethod = get(parts,'pay') || 'bank'
    const notes     = get(parts,'notes') || ''
    const key = date + '_' + amt + '_' + desc.slice(0,20)
    rows.push({ date, desc, amt, direction, category, quarter, payMethod, notes, isDup: dupKey.has(key) })
  }
  return rows
}

function rCsvPreview(q) {
  const fresh = S.csvRows.filter(r => !r.isDup)
  const dups  = S.csvRows.filter(r => r.isDup)
  const inc = fresh.filter(r => r.direction==='income').reduce((s,r) => s+r.amt, 0)
  const exp = fresh.filter(r => r.direction==='expense').reduce((s,r) => s+r.amt, 0)
  return `<div class="iform" style="background:#EFF6FF;border-bottom:1px solid #BFDBFE">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">
      <div style="font-size:13px;font-weight:500;color:#1E40AF"><i class="ti ti-file-import" style="margin-right:5px" aria-hidden="true"></i>${fresh.length} rows to import${dups.length?` · ${dups.length} duplicate${dups.length>1?'s':''} skipped`:''}</div>
      <div style="font-size:12px;color:var(--text-mid)">Income: ${fmt(inc)} · Expenses: ${fmt(exp)}</div>
    </div>
    <div style="overflow-x:auto;max-height:200px;overflow-y:auto;margin-bottom:10px;border-radius:7px;border:1px solid #BFDBFE;background:#fff">
      <table class="tbl" style="font-size:11.5px">
        <thead><tr><th style="width:12%">Date</th><th style="width:30%">Description</th><th style="width:11%">Amount</th><th style="width:9%">Dir</th><th style="width:15%">Category</th><th style="width:8%">Q</th><th style="width:15%">Status</th></tr></thead>
        <tbody>
        ${S.csvRows.slice(0,40).map(r => `<tr ${r.isDup?'style="opacity:.4"':''}>
          <td class="mu">${r.date}</td><td>${r.desc}</td>
          <td class="fw">${fmt(r.amt)}</td>
          <td>${bdg(r.direction==='income'?'b-in':'b-ex',r.direction)}</td>
          <td class="xs mu">${ALL_CATS[r.category]||r.category}</td>
          <td>${bdg('b-rv',r.quarter)}</td>
          <td>${r.isDup?bdg('b-wa','duplicate'):bdg('b-in','new')}</td>
        </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="frow">
      <button class="btn btn-primary" onclick="confirmCsvImport()"><i class="ti ti-check" aria-hidden="true"></i>Import ${fresh.length} rows</button>
      <button class="btn btn-outline" onclick="S.csvImport=false;S.csvRows=[];rMain()">Cancel</button>
    </div>
  </div>`
}

// ── Actions ───────────────────────────────────────────────────────

async function doAdd(q) {
  const date = v('af-dt')
  const desc = v('af-de')
  const amt  = fv('af-am')
  const dir  = v('af-di')
  const cat  = v('af-ca')
  const pm   = v('af-pm')
  const notes= v('af-no')

  if (!date || !desc || !amt || !cat) return alert('Please fill in date, description, amount and category.')
  if (!dateToQ(date)) return alert(`That date isn't in the 2025/26 tax year (6 Apr 2025 – 5 Apr 2026).`)

  const actualQ = dateToQ(date)
  if (actualQ !== q) {
    if (!confirm(`That date falls in ${actualQ}, not ${q}. Save to ${actualQ} instead?`)) return
  }

  try {
    const row = await api('POST', '/api/transactions', {
      transaction_date: date, description: desc, amount: amt,
      direction: dir, category: cat, quarter: actualQ,
      pay_method: pm, notes,
    })
    S.txs.push(row)
    S.addForm = false
    showToast('Transaction saved')
    rMain()
  } catch (err) { showToast(err.message, false) }
}

async function delTx(id) {
  if (!confirm('Delete this transaction?')) return
  try {
    await api('DELETE', `/api/transactions/${id}`)
    S.txs = S.txs.filter(t => t.id !== id)
    showToast('Deleted')
    rMain()
  } catch (err) { showToast(err.message, false) }
}

function confirmClear(q) {
  S.confirmClear = q
  S.addForm = false
  rMain()
}

async function doClear(q) {
  try {
    const result = await api('DELETE', `/api/transactions?quarter=${q}`)
    S.txs = S.txs.filter(t => t.quarter !== q)
    S.confirmClear = null
    showToast(`${result.deleted} transactions deleted from ${q}`)
    rMain()
  } catch (err) { showToast(err.message, false) }
}

// ── CSV Export ────────────────────────────────────────────────────

function doExport(quarter) {
  const rows = quarter === 'all' ? S.txs : S.txs.filter(t => t.quarter === quarter)
  const hdr  = ['Date','Description','Amount','Direction','Category','Category (HMRC)','Quarter','Payment Method','Notes','Receipt Ref']
  const data = rows.map(t => [
    t.transaction_date, t.description, Number(t.amount).toFixed(2),
    t.direction, t.category, ALL_CATS[t.category] || t.category,
    t.quarter, PAY_METHODS[t.pay_method] || t.pay_method, t.notes || '', t.receipt_ref || '',
  ])
  const csv  = [hdr, ...data].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\r\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = `BGD-MTD-${quarter}-2025-26.csv`
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function exportTaxSummary() {
  const yr  = qTotals(null)
  const net = Math.max(0, yr.profit)
  const t   = calcTax(net)
  const rows = [
    ['BGD Maintenance — Tax Return Summary 2025/26', '', ''],
    ['Generated', new Date().toLocaleDateString('en-GB'), ''],
    ['', '', ''],
    ['INCOME', '', ''],
    ...Object.entries(INCOME_CATS).map(([cat, label]) => {
      const total = S.txs.filter(tx => tx.category === cat).reduce((s,tx) => s+Number(tx.amount),0)
      return [label, total ? Number(total).toFixed(2) : '0.00', '']
    }),
    ['Total income', Number(yr.income).toFixed(2), ''],
    ['', '', ''],
    ['EXPENSES', '', ''],
    ...Object.entries(EXPENSE_CATS).map(([cat, label]) => {
      const total = S.txs.filter(tx => tx.category === cat).reduce((s,tx) => s+Number(tx.amount),0)
      return [label, total ? Number(total).toFixed(2) : '0.00', '']
    }),
    ['Total expenses', Number(yr.expense).toFixed(2), ''],
    ['', '', ''],
    ['Net profit', Number(net).toFixed(2), ''],
    ['', '', ''],
    ['TAX CALCULATION', '', ''],
    ['Personal allowance', Number(t.pa).toFixed(2), ''],
    ['Taxable income', Number(t.taxableIncome).toFixed(2), ''],
    ['Income tax', Number(t.incomeTax).toFixed(2), ''],
    ['Class 4 NI', Number(t.ni).toFixed(2), ''],
    ['Total estimated tax', Number(t.total).toFixed(2), ''],
    ['', '', ''],
    ['PAYMENT DATES', '', ''],
    ['31 Jan 2027 — balancing payment + 1st POA', Number(t.poa).toFixed(2), 'Plus balancing payment for 25/26'],
    ['31 Jul 2027 — 2nd POA', Number(t.poa).toFixed(2), ''],
    ['', '', ''],
    ['NOTE: Estimate only. Confirm with accountant before submitting to HMRC.', '', ''],
  ]
  const csv  = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\r\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = 'BGD-Tax-Return-Summary-2025-26.csv'
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Mileage actions ───────────────────────────────────────────────

async function addMileageJourney() {
  const m = { journey_date: v('ml-dt'), quarter: v('ml-q'), from_location: v('ml-fr'), to_location: v('ml-to'), miles: fv('ml-mi'), purpose: v('ml-pu'), notes: v('ml-no') }
  if (!m.journey_date || !m.purpose || !m.miles) return alert('Date, purpose and miles are required.')
  try {
    const row = await api('POST', '/api/mileage', m)
    S.mileage.push(row); S.addMileage = false
    showToast('Journey saved'); rMain()
  } catch (err) { showToast(err.message, false) }
}

async function delMileage(id) {
  if (!confirm('Delete this journey?')) return
  try {
    await api('DELETE', `/api/mileage/${id}`)
    S.mileage = S.mileage.filter(m => m.id !== id)
    showToast('Deleted'); rMain()
  } catch (err) { showToast(err.message, false) }
}

async function addMileageToMTD(quarter, claim) {
  const dates = { Q1:'2025-06-30', Q2:'2025-09-30', Q3:'2025-12-31', Q4:'2026-03-31' }
  if (!confirm(`Add £${claim.toFixed(2)} mileage claim to ${quarter} MTD records?`)) return
  try {
    const row = await api('POST', '/api/transactions', {
      transaction_date: dates[quarter], description: `HMRC mileage claim — ${quarter} 2025/26`,
      amount: claim, direction: 'expense', category: 'travel', quarter, pay_method: 'bank',
      notes: 'Approved mileage allowance — 45p/25p per mile (AMAP)',
    })
    S.txs.push(row); showToast(`${quarter} mileage added to MTD`); rMain()
  } catch (err) { showToast(err.message, false) }
}

function exportMileage() {
  const sorted = [...S.mileage].sort((a,b) => a.journey_date.localeCompare(b.journey_date))
  const { detailed, totalMiles, totalClaim } = calcMileage(sorted)
  const hdr  = ['Date','From','To','Purpose','Quarter','Miles','Claim (£)','Rate','Notes']
  const rows = detailed.map(m => [m.journey_date, m.from_location, m.to_location, m.purpose, m.quarter, m.miles, m.claim.toFixed(2), m.claim/m.miles >= 0.44?'45p':'25p', m.notes])
  rows.push(['','','','','Total',totalMiles.toFixed(1),totalClaim.toFixed(2),'',''])
  const csv = [hdr,...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\r\n')
  const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href = url; a.download = 'BGD-Mileage-2025-26.csv'
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── CSV import action ─────────────────────────────────────────────

async function confirmCsvImport() {
  const fresh = S.csvRows.filter(r => !r.isDup)
  if (!fresh.length) return showToast('Nothing new to import', false)
  const payload = fresh.map(r => ({
    transaction_date: r.date, description: r.desc, amount: r.amt,
    direction: r.direction, category: r.category, quarter: r.quarter,
    pay_method: r.payMethod || 'bank', notes: r.notes || '',
  }))
  try {
    const result = await api('POST', '/api/transactions', payload)
    const saved = Array.isArray(result) ? result : [result]
    S.txs.push(...saved)
    S.csvRows = []; S.csvImport = false
    showToast(`${saved.length} transaction${saved.length===1?'':'s'} imported`)
    rMain()
  } catch (err) { showToast(err.message, false) }
}

// ── Expose globals ────────────────────────────────────────────────

Object.assign(window, { go, rMain, S, doAdd, delTx, confirmClear, doClear, doExport, exportTaxSummary, rAddCats, loadAll, addMileageJourney, delMileage, addMileageToMTD, exportMileage, handleCsvUpload, confirmCsvImport })

// ── Init ──────────────────────────────────────────────────────────

rNav()
loadAll()
