#!/usr/bin/env python3
"""Generate a short-lived admin JWT to activate a user via /admin/activate."""
import time
import jwt
from datetime import datetime, timedelta, timezone

ADMIN_TOKEN_SECRET = input("Colle ton ADMIN_TOKEN_SECRET : ").strip()
ADMIN_TOKEN_AUDIENCE = "vocalype-admin"

now = int(time.time())
payload = {
    "sub": "admin-cli",
    "aud": ADMIN_TOKEN_AUDIENCE,
    "iat": now,
    "exp": now + 300,
    "scope": "admin:activate",
}

token = jwt.encode(payload, ADMIN_TOKEN_SECRET, algorithm="HS256")
print(f"\nToken admin (valide 5 min) :\n{token}\n")
