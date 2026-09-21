# Private owner access

The operational workspace now uses one configured owner username/password.
Public marketing, aggregate insights and demo requests remain public. Operational
routes reject direct calls, including calls from unrelated AppDeploy accounts.
Only a validated owner session can dispatch the explicitly listed workspace operations.
Automation retains its existing GitHub OIDC policy and economy schedules.

Credentials are configured through AppDeploy's encrypted secret-entry flow as
`HIRER_OWNER_ACCESS`. The value is JSON containing version 1, username, a UUID v4
ownerId, a random 16-byte lowercase hexadecimal salt, and a 64-byte lowercase
hexadecimal passwordHash. Derive the hash using Node scrypt with N=32768, r=8,
p=1 and maxmem=64 MiB. Never put the credential or its verifier into Git, frontend
code, tests, deployment payloads or logs.

Sessions are random opaque 32-byte values; only their SHA-256 hashes select
backend session records. Remembered sessions last 30 days; other sessions last
12 hours and use browser session storage. Every operation validates the session
on the server. Logout persistently revokes it. Secret rotation invalidates all
existing sessions. Preserve ownerId when rotating a password to retain the same
owner's CRM and report history. Prior social-account data stays isolated and is
not automatically reassigned.

Missing or malformed configuration fails closed. Login attempts use a bounded,
durable 15-minute budget per trusted gateway IP; SDK storage has no atomic
compare-and-swap, so this is best-effort under concurrent requests. Database
quota errors retain HTTP 429 without exposing dependency details or retrying.
Password reset requires replacing the encrypted secret through the same secure flow.
