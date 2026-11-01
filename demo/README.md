# DemoSolar ERP — sanitized source

This directory is a public portfolio edition of a modular enterprise ERP. It preserves the application structure and workflow code while replacing private business information with fictional demo values.

## Safety boundaries

- No production database or SQL dump is included.
- No passwords, API keys, session secrets, private certificates, or uploaded documents are included.
- Names, phone numbers, email addresses, tax identifiers, company address, internal IP addresses, and domains are fictional or reserved examples.
- `192.0.2.0/24` addresses are documentation-only addresses and do not identify live infrastructure.
- `example.test` addresses cannot deliver real email or resolve as a production domain.

## Demo fixtures

Representative fictional records are in `data/demo-data.json`. They document the expected shape of common ERP records but are not automatically imported into a database.

## Local configuration

Copy `.env.example` values into your preferred web-server environment configuration and replace every `CHANGE_ME` value locally. Never commit the resulting secrets.

The PHP application expects an independently initialized MariaDB/MySQL database. The production schema and production data are deliberately not part of this portfolio repository.
