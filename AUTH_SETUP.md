# Auth and Billing Setup

The repo now includes a compatible Flask backend in `backend/app.py`.

Flow:

1. `register` creates the account.
2. `login` returns a JWT session.
3. Registration immediately starts a 7-day free trial without requiring a card.
4. The desktop app calls `/auth/session` to unlock access during the trial.
5. After the trial ends, `checkout` opens Stripe to start a paid subscription.
6. Stripe webhook marks the user as `active`, `past_due`, `canceled`, or another Stripe subscription state.

## Railway variables

Set these variables on your Railway service:

```bash
ADMIN_TOKEN_SECRET=
ADMIN_TOKEN_AUDIENCE=vocaltype-admin
ADMIN_TOKEN_MAX_AGE_SECONDS=300
JWT_SECRET=
OPENAI_API_KEY=
STRIPE_PRICE_ID=
STRIPE_PUBLISHABLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

`ADMIN_SECRET` is deprecated. Admin endpoints now expect a short-lived JWT in
`Authorization: Bearer ...`, signed with `ADMIN_TOKEN_SECRET`, scoped with
`admin:activate`, and addressed to the `ADMIN_TOKEN_AUDIENCE` value.

## Backend files

```text
backend/app.py
backend/requirements.txt
scripts/admin-activate-user.py
scripts/generate-admin-token.py
```

## Generate an admin token locally

From the repo root:

```bash
export ADMIN_TOKEN_SECRET="replace-me"
python scripts/generate-admin-token.py --subject your-name
```

Raw token only:

```bash
python scripts/generate-admin-token.py --raw
```

Activate a user directly:

```bash
export ADMIN_TOKEN_SECRET="replace-me"
export VOCALTYPE_API_URL="https://your-railway-api.up.railway.app"
python scripts/admin-activate-user.py --email user@example.com
```

## Frontend variable

Set this variable for the Vite/Tauri app:

```bash
VITE_AUTH_API_URL=https://your-railway-api.up.railway.app
```

## Required API endpoints

The frontend calls these endpoints:

```text
POST /auth/register
POST /auth/login
GET  /auth/session
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
something like:

```json
{
  "subscription": {
    "status": "inactive",
    "trial_ends_at": "2026-03-16T00:00:00+00:00",
    "current_period_ends_at": null,
    "has_access": false
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
