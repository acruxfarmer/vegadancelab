# Supabase database trust

`supabase-prod-ca-2021.crt` is the public root certificate linked by the authenticated `vega-development` project under Database Settings → SSL configuration → Download certificate.

Source: https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Certificate SHA-256 fingerprint: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`

Subject/issuer: Supabase Root 2021 CA, Supabase Inc. Valid April 28, 2021 through April 26, 2031. This is a public shared Supabase CA, not a private key or database credential. Its deployment-wide filename does not select a production database; the client separately pins Vega's development project and login.

The shared database adapter loads this certificate by module-relative path, validates its fingerprint and validity, and sets explicit `ca`, `rejectUnauthorized: true`, SNI hostname, and Node's standard `checkServerIdentity`. This is equivalent to PostgreSQL `verify-full`. URL SSL options cannot replace these explicit settings. The local diagnostic and Render runtime use the same adapter. No system trust store is modified.

If the restricted connection still fails chain validation, inspect the machine/network TLS chain separately. Do not disable certificate validation, trust a certificate obtained only from the failing connection, or rotate database credentials to address a TLS trust error.
