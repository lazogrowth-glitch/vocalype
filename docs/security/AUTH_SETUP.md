# Auth and Billing Setup

The repo now includes a compatible Flask backend in `backend/app.py`.

Flow:

1. `register` creates the account.
2. `login` returns a JWT session.
3. Registration immediately starts a 14-day free trial without requiring a card.
4. The desktop app calls `/auth/session` to unlock access and determine whether the user is on `premium` or `basic`.
5. After the trial ends, users keep Basic access unless they start a paid Stripe subscription.
6. Stripe webhook marks the user as `active`, `past_due`, `canceled`, or another Stripe subscription state.

## Railway variables

Set these variables on your Railway service:

```bash
ADMIN_TOKEN_SECRET=
ADMIN_TOKEN_AUDIENCE=vocalype-admin
ADMIN_TOKEN_MAX_AGE_SECONDS=300
JWT_SECRET=
OPENAI_API_KEY=
STRIPE_PRICE_ID=
STRIPE_PRICE_ID_INDEPENDENT_MONTHLY=
STRIPE_PRICE_ID_INDEPENDENT_YEARLY=
STRIPE_PRICE_ID_POWER_USER_MONTHLY=
STRIPE_PRICE_ID_POWER_USER_YEARLY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

Use `STRIPE_PRICE_ID` for a single checkout offer, or the plan-specific
`STRIPE_PRICE_ID_*` variables when the desktop app should open multiple Stripe
plans (for example Independent/Power User with monthly/yearly billing).

Email delivery for password reset and trial emails:

```bash
RESEND_API_KEY=
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=Vocalype <no-reply@vocalype.com>
```

For Resend on Render, prefer `RESEND_API_KEY` because it sends over HTTPS
instead of SMTP. If `RESEND_API_KEY` is not set, the password reset sender also
accepts the Resend API key in `SMTP_PASS` for backward compatibility.

If `SMTP_HOST` is empty, `/auth/forgot-password` still returns `{ "ok": true }`
for privacy, but no email is sent.

Recommended production additions:

```bash
TRUST_X_FORWARDED_FOR=0
DATABASE_PATH=/secure/path/vocalype.db
CORS_ALLOWED_ORIGINS=https://vocalype.com,https://www.vocalype.com
```

If you enable `TRUST_X_FORWARDED_FOR=1`, only do it behind a trusted reverse
proxy that overwrites `X-Forwarded-For`.

`ADMIN_SECRET` is deprecated. Admin endpoints now expect a short-lived JWT in
`Authorization: Bearer ...`, signed with `ADMIN_TOKEN_SECRET`, scoped with
`admin:activate`, and addressed to the `ADMIN_TOKEN_AUDIENCE` value.

## Backend files

```text
backend/app.py
backend/requirements.txt
scripts/admin/admin-activate-user.py
scripts/admin/generate-admin-token.py
```

## Generate an admin token locally

From the repo root:

```bash
export ADMIN_TOKEN_SECRET="replace-me"
python scripts/admin/generate-admin-token.py --subject your-name
```

Raw token only:

```bash
python scripts/admin/generate-admin-token.py --raw
```

Activate a user directly:

```bash
export ADMIN_TOKEN_SECRET="replace-me"
export VOCALYPE_API_URL="https://your-railway-api.up.railway.app"
python scripts/admin/admin-activate-user.py --email user@example.com
```

## Frontend variable

Set this variable for the Vite/Tauri app:

```bash
VITE_AUTH_API_URL=https://your-railway-api.up.railway.app
```

## Windows production notes

- Do not run the Flask development server in production.
- Restrict filesystem access to the backend directory and SQLite database.
- Keep secrets outside the repo and outside synced desktop folders.
- Review [SECURITY_CHECKLIST.md](./SECURITY_CHECKLIST.md) before release.

## Required API endpoints

The frontend calls these endpoints:

```text
POST /auth/register
POST /auth/login
GET  /auth/session
POST /auth/forgot-password
POST /auth/verify-reset-code
POST /auth/reset-password
POST /billing/checkout
POST /billing/portal
```

## Expected response shape

`/auth/register`, `/auth/login`, and `/auth/session` should return:

```json
{
  "token": "jwt",
  "user": {
    "id": "user_id",
    "email": "user@example.com",
    "name": "User"
  },
  "subscription": {
    "status": "trialing",
    "trial_ends_at": "2026-03-16T00:00:00+00:00",
    "current_period_ends_at": null,
    "has_access": true
  }
}
```

`/billing/checkout` and `/billing/portal` should return:

```json
{
  "url": "https://checkout.stripe.com/..."
}
```

After the free trial ends without payment, `/auth/session` should return
something like a Basic tier session:

```json
{
  "subscription": {
    "status": "inactive",
    "trial_ends_at": "2026-03-16T00:00:00+00:00",
    "current_period_ends_at": null,
    "has_access": true,
    "tier": "basic",
    "quota": {
      "count": 0,
      "limit": 30,
      "remaining": 30,
      "reset_at": "2026-03-23T00:00:00+00:00"
    }
  }
}
```

After a successful Stripe checkout, the webhook should update the user to
something like:

```json
{
  "subscription": {
    "status": "active",
    "trial_ends_at": "2026-03-16T00:00:00+00:00",
    "current_period_ends_at": "2026-04-16T00:00:00+00:00",
    "has_access": true
  }
}
```
