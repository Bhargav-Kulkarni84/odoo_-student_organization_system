# Skyline Student Association

A full-stack platform for managing a student organization in one place:
memberships, events and tickets, merchandise, announcements, volunteer
tasks, fundraisers, expenses, and financial reporting.

## Overview

Skyline Student Association replaces spreadsheets, paper ticket lists,
chat-based announcements, and manual budget tracking with a centralized
web application. This repository contains a React frontend and an
Express API backed by PostgreSQL.

## Technology stack

**Frontend** - React, TypeScript, Vite - Tailwind CSS v4 - React
Router - Lucide icons

**Backend** - Node.js, Express, TypeScript - PostgreSQL - JWT
authentication - Zod request validation - bcrypt password hashing

**Optional integrations** - AWS S3 for private receipt storage - SMTP or
an email provider for notifications and receipts - A payment gateway and
signed webhooks for online payment confirmation

Optional integrations require credentials and backend configuration. A
screen or database field alone does not mean an integration is enabled.

## Features

-   User registration and login
-   Membership plans, applications, status, and renewal
-   Event discovery and ticket types with member/non-member pricing
-   Ticket orders, ticket codes, and check-in
-   Merchandise products, variants, inventory, and orders
-   Announcements and recipient tracking
-   Fundraisers and volunteer task assignments
-   Expense submission, review, and reimbursement tracking
-   Financial transaction ledger and reporting
-   Responsive desktop and mobile interface

### Extended requirements

The project also aims to support: - Membership approval subject to
available club capacity - Club-lead approval of membership
applications - A configurable monthly volunteer-hours threshold -
Transaction receipts stored privately in AWS S3 and emailed to
recipients

These features may need database migrations, backend enforcement,
email/S3 configuration, and integration tests before they are
production-ready. Capacity and hour limits must be enforced by the
backend, not only by the frontend.

## Project structure

``` text
skyline-student-organization-system/
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   ├── middleware/
│   │   ├── validations/
│   │   └── db/
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── lib/
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   └── .env.example
└── README.md
```

The exact file structure may differ slightly as the project evolves.

## Prerequisites

Install: - Node.js (current LTS recommended) - npm - PostgreSQL - Git
(optional)

AWS and an SMTP/email provider are needed only if those integrations are
enabled.

## Getting started

### 1. Configure the backend

``` bash
cd backend
npm install
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of
`cp`.

Edit `backend/.env` with your PostgreSQL connection details and a
strong, random JWT secret. Example variable names:

``` env
DB_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=1h
PORT=3000
```

This is an example only. Follow the actual variable names expected by
your backend's `.env.example` and database configuration.

### 2. Configure the frontend

Open a second terminal:

``` bash
cd frontend
npm install
cp .env.example .env
```

Set the API base URL in `frontend/.env`:

``` env
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

Vite exposes `VITE_` variables to browser code. Never put database
passwords, JWT signing secrets, AWS secret keys, or SMTP passwords in
frontend environment variables.

## Database setup

1.  Create a PostgreSQL database.
2.  Apply the initial schema or migrations in the order documented by
    the backend.
3.  If using an existing database, back it up before applying new
    migrations.
4.  Confirm the backend points to the intended database.

Do not rerun an initial schema against an existing database without
reviewing it first. Apply optional feature migrations only after
reviewing the SQL and backing up data.

For a SQL schema file, a typical command is:

``` bash
psql "YOUR_DATABASE_URL" -f path/to/schema.sql
```

Replace the path with the actual schema file. Keep database credentials
private.

## Running the application

### Start the backend

From `backend/`, use the development script in `package.json`, for
example:

``` bash
npm run dev
```

If no development script is configured, use the command appropriate for
your setup, such as:

``` bash
npx tsx src/index.ts
```

The API is expected at `http://localhost:3000`.

### Start the frontend

From `frontend/`:

``` bash
npm run dev
```

Vite typically serves the frontend at `http://localhost:5173`. Keep both
terminals running and open that URL in your browser.

### Build and type-check

From `frontend/`:

``` bash
npm run build
```

From `backend/`, if TypeScript is configured:

``` bash
npx tsc --noEmit
```

The exact scripts available are listed in each package's `package.json`.

## Environment variables

  -----------------------------------------------------------------------
  Variable                Used by                 Purpose
  ----------------------- ----------------------- -----------------------
  `DB_URL`                Backend                 PostgreSQL connection
                                                  string, if used by the
                                                  current configuration

  `JWT_SECRET`            Backend                 Signs and verifies
                                                  authentication tokens

  `JWT_EXPIRES_IN`        Backend                 Intended token
                                                  lifetime; confirm the
                                                  login code applies it

  `PORT`                  Backend                 API listening port,
                                                  commonly `3000`

  `VITE_API_BASE_URL`     Frontend                Base URL for API
                                                  requests

  AWS region, bucket,     Backend, if enabled     Receipt storage
  credentials                                     

  SMTP/email settings     Backend, if enabled     Announcement and
                                                  receipt email delivery
  -----------------------------------------------------------------------

Use the exact variable names expected by your code. Store real values in
local environment files or a secret manager, not in this README.

## API overview

Routes are mounted under `/api/v1`. Main route groups include:

  Module              Example route base
  ------------------- ----------------------------------------
  Authentication      `/api/v1/auth`
  Memberships         `/api/v1/memberships`
  Events              `/api/v1/events`
  Ticket types        `/api/v1/events/:eventId/ticket-types`
  Ticket orders       `/api/v1/ticket-orders`
  Ticket check-in     `/api/v1/tickets`
  Payments            `/api/v1/payments`
  Merchandise         `/api/v1/merchandise`
  Announcements       `/api/v1/announcements`
  Tasks               `/api/v1/tasks`
  Fundraisers         `/api/v1/fundraisers`
  Expenses            `/api/v1/expenses`
  Financial reports   `/api/v1/financial-reports`

Use the route files and validation schemas as the source of truth for
request bodies, response formats, and authorization requirements.

## Extended feature design

### Membership capacity and approval

Check available capacity inside a database transaction so simultaneous
applications cannot exceed the limit. Applications should remain pending
until an authorized club lead approves or rejects them. Display
application status and availability in the frontend.

### Monthly volunteer-hours threshold

Record dated hour entries tied to a user and, where relevant, a task.
Before accepting an entry, the backend should calculate the user's hours
for that calendar month and enforce the configured threshold safely.
Validate on the server, not only in the browser.

### Transaction receipts

Recommended workflow: 1. Confirm a transaction is successful or an
offline payment has been verified. 2. Generate a PDF with a unique
receipt number and transaction details. 3. Store the PDF in a private S3
bucket. 4. Save receipt metadata and the S3 object key in PostgreSQL. 5.
Queue an email to the recipient. 6. Retry temporary failures and record
delivery status. 7. Provide authenticated receipt-history and download
endpoints.

Never expose AWS credentials to the browser or make the bucket public.
Prefer short-lived pre-signed URLs for authorized downloads. Do not mark
a payment successful based solely on a browser request; use a trusted
provider webhook or a verified offline-payment process.

## Testing and troubleshooting

### API returns `500 Internal Server Error`

Check the backend terminal for the underlying error. Common causes
include: - The API is connected to the wrong database. - A schema or
migration has not been applied. - A route query references a column that
does not exist. - Database credentials or connectivity are invalid.

Inspect the actual PostgreSQL error before changing or recreating
tables.

### Frontend cannot connect to the API

1.  Confirm the backend is running.

2.  Test an endpoint directly:

    ``` bash
    curl -i http://localhost:3000/api/v1/events
    ```

3.  Confirm `VITE_API_BASE_URL` in `frontend/.env`.

4.  Restart Vite after changing environment variables.

5.  If the browser reports a CORS error, configure Express to allow the
    frontend origin, such as `http://localhost:5173`.

A `500` means the server was reached but failed while processing the
request; it is different from a network connection failure.

### Authentication fails

-   Confirm protected requests send `Authorization: Bearer <token>`.
-   Confirm the frontend and backend use the expected API URL.
-   Check the backend terminal for token validation errors.
-   Ensure token expiry is configured and enforced.

### Build errors

Run the build command and address the first reported TypeScript or
dependency error. Install packages in the correct `frontend/` or
`backend/` directory.

## Security notes

-   Never commit `.env`, database credentials, JWT secrets, AWS keys, or
    SMTP credentials.
-   Rotate any secret or bearer token accidentally shared.
-   Use strong JWT secrets and enforce token expiry.
-   Restrict sensitive management actions on the backend using
    role/permission checks.
-   Validate and authorize requests on the server.
-   Use HTTPS in production.
-   Keep receipts in private storage and authorize downloads.
-   Use transactions and database constraints for inventory, capacity,
    payment idempotency, and financial-ledger operations.
-   Back up the database before migrations.

## Future improvements

-   Integrate a live payment gateway with signed webhook verification.
-   Add email delivery workers, retries, and delivery monitoring.
-   Add membership-renewal reminders.
-   Add attendance and event-revenue analytics.
-   Add audit logs for approvals and financial changes.
-   Add automated unit, API integration, and end-to-end tests.
-   Deploy with managed PostgreSQL and secure secret management.

## Contributing

1.  Create a branch for your change.
2.  Keep components small and responsibilities clear.
3.  Follow the existing TypeScript and validation conventions.
4.  Test affected API routes and UI.
5.  Do not commit generated build output, dependency folders, or
    secrets.

## License

Add the license required by your project or institution before
publishing the repository publicly.
