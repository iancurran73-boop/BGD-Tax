'use strict'
require('dotenv').config()

const express = require('express')
const { Pool, types } = require('pg')
const path    = require('path')

// Return dates as strings, not JS Date objects
types.setTypeParser(1082, v => v)
types.setTypeParser(1114, v => v)
types.setTypeParser(1184, v => v)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
})

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const wrap = fn => (req, res, next) => fn(req, res).catch(next)

// ── Health ────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ ok: true }))

// ── Transactions ──────────────────────────────────────────────────

app.get('/api/transactions', wrap(async (req, res) => {
  const { quarter } = req.query
  const q = quarter
    ? 'SELECT * FROM transactions WHERE quarter = $1 ORDER BY transaction_date, created_at'
    : 'SELECT * FROM transactions ORDER BY transaction_date, created_at'
  const { rows } = await pool.query(q, quarter ? [quarter] : [])
  res.json(rows)
}))

app.post('/api/transactions', wrap(async (req, res) => {
  const input = Array.isArray(req.body) ? req.body : [req.body]
  const results = []
  for (const t of input) {
    const { rows } = await pool.query(
      `INSERT INTO transactions
         (transaction_date, description, amount, direction, category, quarter, pay_method, notes, receipt_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [t.transaction_date, t.description, t.amount, t.direction, t.category,
       t.quarter, t.pay_method ?? 'bank', t.notes ?? '', t.receipt_ref ?? '']
    )
    results.push(rows[0])
  }
  res.status(201).json(Array.isArray(req.body) ? results : results[0])
}))

app.patch('/api/transactions/:id', wrap(async (req, res) => {
  const allowed = ['transaction_date','description','amount','direction','category','quarter','pay_method','notes','receipt_ref']
  const body = req.body
  const fields = allowed.filter(k => k in body)
  if (!fields.length) return res.status(400).json({ error: 'No valid fields' })
  const vals = fields.map(k => body[k])
  const set  = fields.map((k, i) => `${k} = $${i + 1}`).join(', ')
  const { rows } = await pool.query(
    `UPDATE transactions SET ${set} WHERE id = $${fields.length + 1} RETURNING *`,
    [...vals, req.params.id]
  )
  rows[0] ? res.json(rows[0]) : res.status(404).json({ error: 'Not found' })
}))

app.delete('/api/transactions/:id', wrap(async (req, res) => {
  await pool.query('DELETE FROM transactions WHERE id = $1', [req.params.id])
  res.status(204).end()
}))

// Bulk delete by quarter
app.delete('/api/transactions', wrap(async (req, res) => {
  const { quarter } = req.query
  if (!quarter) return res.status(400).json({ error: 'quarter required' })
  const { rowCount } = await pool.query('DELETE FROM transactions WHERE quarter = $1', [quarter])
  res.json({ deleted: rowCount })
}))

// ── Error handler ─────────────────────────────────────────────────

app.use((err, req, res, _next) => {
  console.error(err.message)
  res.status(500).json({ error: err.message })
})

app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
)

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`BGD MTD running on port ${PORT}`))

// ── Mileage ───────────────────────────────────────────────────────────────────

app.get('/api/mileage', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM mileage_log ORDER BY journey_date, created_at')
  res.json(rows)
}))

app.post('/api/mileage', wrap(async (req, res) => {
  const m = req.body
  const { rows } = await pool.query(
    `INSERT INTO mileage_log (journey_date, from_location, to_location, purpose, miles, quarter, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [m.journey_date, m.from_location ?? '', m.to_location ?? '', m.purpose, m.miles, m.quarter, m.notes ?? '']
  )
  res.status(201).json(rows[0])
}))

app.delete('/api/mileage/:id', wrap(async (req, res) => {
  await pool.query('DELETE FROM mileage_log WHERE id = $1', [req.params.id])
  res.status(204).end()
}))

// ── Archive / clear all ───────────────────────────────────────────────────────

app.delete('/api/transactions/all', wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM transactions')
  res.json({ deleted: rowCount })
}))
