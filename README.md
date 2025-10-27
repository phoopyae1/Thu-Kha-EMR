# Thu Kha (သုခ) EMR  

## Project Overview
Thu Kha (သုခ) EMR is a reference implementation of an electronic medical record platform. It aligns with the BRD by offering patient lookup, visit tracking, clinical insights, and revenue-cycle tooling behind a JSON API protected by JWT authentication and rate limiting.

## Features
- **Authentication & access control** – JWT authentication with role-based authorization, password rotation flows, and rate-limited sensitive endpoints keep data access controlled for every staff persona. 
- **Patient management** – Fuzzy name search, patient registration, and detailed summaries bundle recent visits, diagnoses, medications, labs, vitals, and masked contact details for quick chart reviews.
- **Appointment scheduling** – Availability rules, blackout periods, overlap checks, and lifecycle transitions (including automatic visit creation when completing appointments) power reliable outpatient scheduling.
- **Clinical documentation & insights** – Visit encounters capture diagnoses, prescriptions, labs, and structured observations, while analytics endpoints surface patient-level summaries, lab-based cohorts, and latest visits.
- **Pharmacy & inventory operations** – Electronic prescribing with allergy checking, dispensing workflows, FEFO stock allocation, low-stock dashboards, invoice OCR (via OpenAI), and inventory adjustments cover the dispensary loop end-to-end.
- **Billing & revenue cycle** – Invoice creation, itemized adjustments, payment posting, automated totals, receipt generation, and pharmacy charge capture streamline point-of-sale and claims processes.
- **Reporting & dashboards** – Operational reports deliver patient and provider totals, department-level visit stats, top diagnoses, lab utilization, and rolling visit trends for leadership visibility.
- **Developer tooling** – TypeScript services, Prisma data models, and an OpenAPI contract make it straightforward to extend the API or integrate external agents.

## Installation & Setup

### Prerequisites
- Node.js 20+ and npm
- A PostgreSQL database (Neon, local Postgres, or compatible)
- `openssl` (or similar) to generate a `JWT_SECRET`
- Optional: an OpenAI API key for automated invoice scanning (`OPENAI_API_KEY`)

### Steps
1. **Clone and install dependencies**
   ```bash
   git clone <repo-url>
   cd EMR
   npm install
   ```
2. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   Fill in database credentials (`DATABASE_URL`, `DIRECT_URL`), `JWT_SECRET`, rate-limit settings, and optional `OPENAI_API_KEY`/`OPENAI_INVOICE_MODEL` values.
   To persist patient portal integration snippets to MongoDB Atlas via the Data API, configure:
   - `MONGODB_DATA_API_URL`
   - `MONGODB_DATA_API_FIND_URL`
   - `MONGODB_DATA_API_KEY`
   - `MONGODB_DATA_SOURCE`
   - `MONGODB_DATA_DATABASE`
   - Optional: `MONGODB_DATA_COLLECTION` (defaults to `integrationEmbeds`)
   If you prefer to hard-code a widget without MongoDB, set:
   - `PATIENT_PORTAL_WIDGET_IFRAME` with the full `<iframe>` snippet **or** `PATIENT_PORTAL_WIDGET_URL` with the iframe `src`
   - Optional: `PATIENT_PORTAL_WIDGET_CONTEXT_KEY`, `PATIENT_PORTAL_WIDGET_TITLE`, `PATIENT_PORTAL_WIDGET_ALLOW`, `PATIENT_PORTAL_WIDGET_STYLE`, `PATIENT_PORTAL_WIDGET_LOADING`
3. **Provision the database** – Ensure the target PostgreSQL instance is running and reachable from your development machine.
4. **Apply migrations and seed demo data**
   ```bash
   npm run prisma:migrate
   npm run seed:csv
   ```
5. **Start the development servers**
   ```bash
   npm run dev
   ```
   The API is available at `http://localhost:8080` and the Vite-powered web client at `http://localhost:5173`.

## Neon PostgreSQL Setup
Provision a PostgreSQL instance on [Neon](https://neon.tech) and set the `DATABASE_URL` and `DIRECT_URL` in `.env` (include `sslmode=require` for both). Enable the required extensions:
```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
```

## Migrations & Seeding
Run the database migrations and load the demo CSV data any time you need to refresh your environment:
```bash
npm run prisma:migrate
npm run seed:csv
```

## Staff Walkthrough
Try the scheduling workflow after seeding demo data:
1. Create an appointment for **Dr Tan** today from **10:00–10:30**.
2. Attempt to create another appointment for the same provider and timeslot — the system should block the double booking.
3. Mark the original appointment as complete and verify that the visit appears in the visit list.

## API Documentation

### Swagger UI (Interactive Docs)
Access the full interactive API documentation at:
```
http://localhost:8080/api/docs
```

Features:
- Try all APIs directly from browser
- Authentication testing built-in
- Complete OpenAPI 3.0 specification
- Organized by tags (Patient Portal, Atenxion, etc.)

### API Test Page
Visual testing interface for patient portal APIs:
```
http://localhost:5173/api-test.html
```

### OpenAPI JSON
Raw specification available at:
```
http://localhost:5000/api/docs/openapi.json
```

### Documentation Files
- `docs/atenxion_agent.md` - Atenxion integration guide
- `docs/atenxion-patient-portal-apis.md` - Patient portal API reference
- `docs/PM_ATENXION_SETUP_GUIDE.md` - PM meeting guide
- `ATENXION_READY.md` - Quick start for Atenxion integration

## Deploying to Render
1. Create a new Web Service and connect this repository.
2. Configure environment variables:
   - `DATABASE_URL` (with `sslmode=require`)
   - `DIRECT_URL` (with `sslmode=require`)
   - `JWT_SECRET`
   - `RATE_LIMIT_WINDOW_MIN`
   - `RATE_LIMIT_MAX`
3. Build command: `npm install && npm run build`
4. Start command: `npm start`

## Security Notes
- TLS is enforced by using `sslmode=require` for database connections.
- `express-rate-limit` protects patient and auth endpoints.
- Patient contact details are masked in logs and API responses.
