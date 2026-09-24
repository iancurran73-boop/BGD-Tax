# BGD Maintenance — MTD Workbench

Making Tax Digital workbench for Brian. Tax year 2025/26 (6 Apr 2025 – 5 Apr 2026).

## Deploy to Railway

1. Push this folder to a private GitHub repo
2. Railway → New Project → Deploy from GitHub → select the repo
3. Railway → + New → Database → PostgreSQL
4. PostgreSQL service → Database → Data → run `db/schema.sql`
5. App service → Variables → confirm `DATABASE_URL` is set
6. Redeploy

## Local dev

```bash
npm install
echo "DATABASE_URL=postgresql://..." > .env
npm run dev
```

## Features

- Q1–Q4 transaction entry (income and expenses)
- HMRC-aligned category breakdown
- 2025/26 income tax + Class 4 NI calculation
- Full tax return summary with payment schedule
- CSV export per quarter or full year
- Tax summary CSV export for accountant
- Per-record and per-quarter bulk delete
- Mobile responsive with bottom nav
