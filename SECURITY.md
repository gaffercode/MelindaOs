# Security Policy

This is the public source of MelindaOS, the institutional intelligence layer of RSIA Melinda DHAI, Kediri. It holds
code only: hospital documents, staff and patient data, and credentials are kept outside this repository.

## Reporting a vulnerability

Do not open a public issue for a security problem. Email hai@melinda.co.id with the subject
"MelindaOS security", the affected path, the steps to reproduce, and any possible patient-safety impact.

## Rules for contributors

1. **No patient or staff data.** Never commit personal data (NIK, medical record numbers, birth dates, names with
   contact details). `tools/leak-check.mjs` rejects identity numbers, personal phone numbers and email addresses.
2. **No secrets.** Never commit passwords, API tokens or `.env` contents. Configuration comes from environment
   variables; `dashboard/.env.example` lists them with empty values.
3. **Sample data only.** Files under `dashboard/data/synthetic/` are fictional and labelled as such.

## Data protection

Personal data handled by the running system follows Indonesia's Personal Data Protection Law (UU PDP) and the
Ministry of Health rules on electronic medical records.
