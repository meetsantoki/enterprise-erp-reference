# Architecture Overview

The ERP is structured as a modular browser application backed by a PHP API and MariaDB/MySQL.

## Application layers

1. **Presentation layer** — responsive HTML/CSS views for each operational department.
2. **Workflow layer** — modular JavaScript handles forms, validation, calculations, navigation, live synchronization, notifications, and approval actions.
3. **API layer** — PHP endpoints enforce authentication, feature rights, protected-write rules, request routing, audit creation, and transactional updates.
4. **Data layer** — relational operational tables coexist with indexed runtime records used for incremental synchronization and legacy compatibility.
5. **Offline shell** — a versioned service worker caches static application assets while keeping authentication and operational records network-only.

## Protected change flow

```text
Employee proposes a protected edit
              |
              v
Browser validates and submits an approval request
              |
              v
Server verifies the employee right and stores an immutable request
              |
              v
Routing assigns an authorized approver
              |
              v
Approver accepts or rejects the request
              |
              v
Server applies the decision and affected records atomically
              |
              v
Audit and notification records are generated
```

Direct changes to protected historical records are rejected by the server. Approval decisions update their source request and affected operational modules in one transaction.

## Major engineering concerns

- Fine-grained server-side feature authorization
- Atomic approval transactions
- Record-level synchronization for larger operational datasets
- Append-only audit history
- Concurrency/version conflict detection
- Secure session expiry and revocation
- Separation of static caching from private operational data
- Controlled document and image upload paths

