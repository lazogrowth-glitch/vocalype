# Backend

Flask + Postgres backend used by Vocalype desktop for auth, billing, licensing, and now `Small agency` workspaces.

## Main files

- `app.py` / `wsgi.py`: web entry points
- `generate_admin_token.py`: token helper
- `test_security.py`: security-oriented backend tests
- `.env.example`: local environment template

## Render setup

Use the existing `Procfile`:

```bash
web: gunicorn wsgi:application --bind 0.0.0.0:$PORT --workers 2 --timeout 120
```

Minimum env vars on Render:

- `DATABASE_URL`
- `JWT_SECRET`
- `ADMIN_TOKEN_SECRET`
- `FRONTEND_URL`
- `APP_RETURN_URL`
- `CORS_ALLOWED_ORIGINS`

Billing env vars if Stripe is enabled:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID_INDEPENDENT_MONTHLY`
- `STRIPE_PRICE_ID_INDEPENDENT_YEARLY`
- `STRIPE_PRICE_ID_POWER_USER_MONTHLY`
- `STRIPE_PRICE_ID_POWER_USER_YEARLY`

Optional env vars:

- `LICENSE_SIGNING_KEY`
- `GROQ_API_KEY`
- `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS`

## Small agency backend

The backend now owns:

- `subscription_plan` on `users`
- agency workspaces
- agency members and invites
- shared templates
- shared snippets
- shared dictionary terms

New routes:

- `GET /workspace/team`
- `POST /workspace/team/invite`
- `POST /workspace/team/member/remove`
- `GET /workspace/shared-assets`
- `POST /workspace/shared-assets/template`
- `POST /workspace/shared-assets/snippet`
- `POST /workspace/shared-assets/dictionary`

Important behavior:

- invited users are auto-attached to the workspace when they register, log in, refresh, or reset password with the invited email
- active workspace members are treated as `small_agency` users by the auth session
- Stripe webhook now persists the concrete plan (`independent`, `power_user`, `small_agency` ready)
