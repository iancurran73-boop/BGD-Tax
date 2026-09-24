-- ============================================================
-- BGD Maintenance — MTD Workbench Schema
-- Tax year 2025/26 (6 Apr 2025 – 5 Apr 2026)
-- Run in: Railway Dashboard → PostgreSQL service → Query
-- ============================================================

CREATE TABLE transactions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_date DATE        NOT NULL,
  description      TEXT        NOT NULL,
  amount           NUMERIC     NOT NULL,
  direction        TEXT        NOT NULL CHECK (direction IN ('income','expense')),
  category         TEXT        NOT NULL,
  quarter          TEXT        NOT NULL CHECK (quarter IN ('Q1','Q2','Q3','Q4')),
  pay_method       TEXT        NOT NULL DEFAULT 'bank'
                               CHECK (pay_method IN ('cash','bank','cheque')),
  notes            TEXT        NOT NULL DEFAULT '',
  receipt_ref      TEXT        NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tx_quarter   ON transactions(quarter);
CREATE INDEX idx_tx_date      ON transactions(transaction_date);
CREATE INDEX idx_tx_direction ON transactions(direction);
CREATE INDEX idx_tx_category  ON transactions(category);

-- ── Mileage log ───────────────────────────────────────────────────────────────
-- Run this ALTER if schema was already applied, otherwise it's included above

CREATE TABLE IF NOT EXISTS mileage_log (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_date   DATE        NOT NULL,
  from_location  TEXT        NOT NULL DEFAULT '',
  to_location    TEXT        NOT NULL DEFAULT '',
  purpose        TEXT        NOT NULL,
  miles          NUMERIC(8,1) NOT NULL,
  quarter        TEXT        NOT NULL CHECK (quarter IN ('Q1','Q2','Q3','Q4')),
  notes          TEXT        NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mileage_quarter ON mileage_log(quarter);
CREATE INDEX IF NOT EXISTS idx_mileage_date    ON mileage_log(journey_date);
