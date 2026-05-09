# Security Checklist

## Windows Production

1. Set `JWT_SECRET` and `ADMIN_TOKEN_SECRET` to different random values with at least 32 characters.
2. Keep `TRUST_X_FORWARDED_FOR=0` unless the backend is behind a trusted reverse proxy that rewrites `X-Forwarded-For`.
3. Run the backend behind a real reverse proxy / WSGI stack, not the Flask development server.
4. Restrict NTFS permissions on the backend folder, SQLite database, and log directory.
5. Store secrets outside the repo and outside user profile sync folders.
6. Configure `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, and `STRIPE_WEBHOOK_SECRET` together.
7. Configure SMTP credentials if password reset by email is enabled.
8. Allow inbound traffic only to the ports you actually use.
9. Monitor logs for `security_event=login_failed`, `security_event=origin_rejected`, and `security_event=rate_limit_triggered`.
10. Run dependency checks before each release: `bun audit`, `python -m pip_audit -r backend/requirements.txt`, `cargo audit`.

## Files To Review

- `backend/.env.example`
- `backend/app.py`
- `AUTH_SETUP.md`

## Current Scope

The remaining Rust advisories reported by `cargo audit` are informational warnings tied mainly to Linux / GTK3 dependencies. For a Windows-only deployment, they are not the primary production risk.
