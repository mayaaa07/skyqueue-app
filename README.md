# SkyQueue — Airplane Standby Passenger Allocation System

A working full-stack implementation of the DBMS mini-project, built on a deliberately simple
stack so it runs on any laptop with zero external setup:

- **Frontend:** plain HTML, CSS, vanilla JavaScript (no framework, no build step)
- **Backend:** Node.js + Express (REST API)
- **Database:** SQLite via `better-sqlite3` (a real relational database, stored as a single
  file — no MySQL/XAMPP server to install or configure)

The schema, triggers, and transaction logic map directly onto the MySQL design in your written
report — SQLite uses the same SQL dialect for everything used here (tables, foreign keys,
triggers, transactions).

## What's implemented

- Passenger registration & login
- Flight search (by source / destination / date)
- Ticket booking with automatic seat numbering
- **Standby queue** when a flight is full
- **Automatic seat allocation on cancellation** — the core feature: cancelling a confirmed
  booking finds the first eligible standby passenger (FIFO by queue position), reassigns the
  freed seat to them, updates their booking + payment + standby status, and recalculates the
  remaining queue positions — all inside one atomic DB transaction (rolls back on any error)
- Payment record creation and refund marking on cancellation
- Admin dashboard: add flights, view all bookings/standby lists, KPI summary, and a
  **trigger-generated audit log** (every booking insert/cancel is logged automatically by a
  SQL trigger, not application code)

## Project structure

```
airline-app/
├── server.js          # Express app + all API routes + business logic
├── db.js              # Opens/creates the SQLite database on first run
├── db/
│   └── schema.sql     # Tables, foreign keys, triggers, seed data
├── public/
│   ├── index.html     # Passenger-facing app (search, book, dashboard)
│   ├── admin.html      # Admin dashboard
│   ├── css/style.css
│   └── js/
│       ├── app.js      # Passenger frontend logic
│       └── admin.js    # Admin frontend logic
└── package.json
```

## How to run it

1. Install Node.js (v18 or later) if you don't have it: https://nodejs.org
2. Open a terminal in this folder and run:
   ```bash
   npm install
   npm start
   ```
3. Open **http://localhost:3000** in your browser — that's the passenger app.
4. Open **http://localhost:3000/admin.html** for the admin dashboard.
   - Demo login: `admin@airline.com` / `admin123` (pre-filled)

The database file (`db/airline.sqlite`) is created automatically the first time you run the
app, seeded with 4 demo flights (one of them — AI-202, Delhi → Bengaluru — is already full, so
you can demo the standby flow immediately).

## Suggested demo script for your viva

1. **Register two passengers** (e.g. "Riya" and "Karan").
2. Search **Delhi → Bengaluru** — flight AI-202 shows **FULL**.
3. Log in as Riya, click **Join standby** on AI-202 → she gets queue position #1.
4. Open the **admin dashboard** in another tab, add a small test flight with 1 seat, and book
   it with a second passenger to set up a demo scenario, or use the seeded flights directly.
5. Log in as the confirmed passenger on that flight and click **Cancel ticket**.
6. Switch back to the standby passenger's dashboard — their standby entry now shows
   **Allocated**, and a new confirmed booking with the same seat number appears in "My bookings."
7. Open the admin **Audit log** table and point out the trigger-generated rows for the insert
   and cancel — a good moment to walk through the trigger code in `db/schema.sql`.

## Where each DBMS concept lives (for your report / viva Q&A)

| Concept | Where |
|---|---|
| Primary/Foreign keys, constraints | `db/schema.sql` — every table |
| Triggers | `trg_booking_insert_seats`, `trg_booking_cancel_log` in `db/schema.sql` |
| Transactions (atomic multi-step updates) | `server.js` — `/api/cancel` and `/api/book` use `db.transaction()` so a failure rolls back every step |
| Joins | `/api/bookings/:id`, `/api/standby/:id`, and all admin list routes |
| Aggregate functions | `/api/admin/summary` (`COUNT`, `SUM`) |
| Normalization | Passenger / Flight / Booking / Standby / Payment / Admin kept as separate 3NF tables, linked by foreign keys rather than duplicated fields |

## Extending it

This prototype implements the "Phase 1" core from the features roadmap document shared earlier.
Any of the "Medium" difficulty features from that roadmap (loyalty points, promo codes,
audit-based RBAC, baggage billing, etc.) can be added as new tables plus a few new routes
without restructuring what's already here.
