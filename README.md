# Kilomate — Automated delivery invoicing

> From a raw list of deliveries to ready-to-send invoices, in one upload.

Companies that make many deliveries spend hours consolidating transport data, computing distances, applying their price grid and preparing invoices by hand. **Kilomate** automates the whole chain.

**Status:** working product, in testing (founded October 2025).

---

## How it works

1. **Upload** an Excel or CSV file of deliveries
2. **Validate** addresses before anything is computed
3. **Compute distances** with the Google Distance Matrix API
4. **Apply pricing**: configurable grids by distance band, excluding/including VAT
5. **Group** deliveries by customer and compute the billable amounts
6. **Generate** one PDF invoice per customer, plus a ZIP of all invoices

## Engineering highlights

- **Modular NestJS back end**: separate `upload`, `address-validation`, `distance`, `pricing`, `processing` and `invoice` modules
- **Tests** with Jest: unit tests per service and end-to-end tests
- **Performance work**: timing instrumentation (`common/perf.ts`) used to investigate a processing limit around 1,000 lines during tests on files of up to ~1,200 deliveries
- **Auth and storage** with Supabase

## Tech stack

| Layer | Tools |
|---|---|
| Front end | Next.js, React, TypeScript, Tailwind CSS |
| Back end | NestJS, TypeScript |
| Data and auth | Supabase (PostgreSQL) |
| External APIs | Google Distance Matrix |
| Files | `xlsx` (import), Puppeteer and PDFKit (PDF), Archiver (ZIP) |
| Tests | Jest |

## Project structure

```
backend/    NestJS API (upload, address validation, distance, pricing, processing, invoices)
frontend/   Next.js app (login, uploads, validation, processing, invoice preview, dashboard)
```

## Getting started

```bash
# Back end
cd backend
npm install
npm run start:dev

# Front end
cd frontend
npm install
npm run dev
```

Configure Supabase and Google API credentials in each app's environment file (never commit them).

```bash
cd backend
npm test        # unit tests
npm run test:e2e
```

## Author

Built by **Sheril Kuete Hanfo** — engineer (Mines Saint-Étienne), founder of Kilomate.
