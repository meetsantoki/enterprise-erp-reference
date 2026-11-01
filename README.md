# Enterprise ERP Reference

A portfolio reference implementation of a browser-based enterprise resource planning system. It demonstrates how operational departments can work from one role-aware application while preserving approval controls and an auditable history.

## Functional areas

- Sales orders and Customer Order (C/O) lifecycle
- Administrator approval requests for protected edits and deletions
- Purchase orders and vendor registration
- Production, packing, pallet, warehouse, and dispatch workflows
- Accounts invoices, receipts, and customer balances
- Employee tour and recharge expenses
- Role-based user rights, request routing, notifications, and audit logs
- Incremental synchronization for larger operational datasets

## Architecture

- Frontend: modular JavaScript, HTML, and CSS
- Backend: PHP 8 and MariaDB/MySQL
- Offline shell: versioned service worker
- Security: server-side authorization, protected write validation, session controls, and append-only audits

## Portfolio scope

This public repository contains a sanitized demo edition of the application. Production databases, credentials, customer records, employee documents, uploaded files, signatures, photos, backups, company identifiers, and environment-specific configuration are intentionally excluded.

The repository is intended to demonstrate application structure and engineering work. The source under `demo/` uses fictional contacts and reserved example infrastructure values. It is not a production deployment package and requires environment-specific configuration, dependencies, and an independently initialized database before it can run.

## Sanitized implementation structure

The public demo preserves the main application structure while excluding production records and secrets:

- `index.html` — main application interface
- `js/` — modular frontend workflows
- `backend/` — API, authorization, audit, and workflow services
- `assets/` — styles and client-side support files
- `service-worker.js` — application-shell caching
- `demo/` — sanitized application source and fictional fixtures

