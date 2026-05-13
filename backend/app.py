#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import secrets
import smtplib
import psycopg2
from psycopg2.extras import RealDictCursor
import re
import time
import uuid
import hashlib
import json
from contextlib import contextmanager
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from functools import wraps
from threading import Lock
from typing import Optional
from urllib import error as urlerror
from urllib import request as urlrequest

import base64

import jwt
import stripe
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, NoEncryption
from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__)

DEFAULT_ALLOWED_ORIGINS = (
    "https://vocalype.com",
    "https://www.vocalype.com",
    "tauri://localhost",
    "https://tauri.localhost",
    "http://tauri.localhost",
    "http://localhost:1420",
    "http://127.0.0.1:1420",
)
EMAIL_REGEX = re.compile(
    r"^(?=.{1,254}$)(?=.{1,64}@)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}$",
    re.IGNORECASE,
)


def env_int(name: str, default: int, minimum: int) -> int:
    try:
        return max(minimum, int(os.environ.get(name, str(default))))
    except (TypeError, ValueError):
        return default


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def parse_allowed_origins() -> list[str]:
    raw = os.environ.get("CORS_ALLOWED_ORIGINS", "")
    if raw.strip():
        origins = [item.strip() for item in raw.split(",") if item.strip()]
        if origins:
            return origins
    return list(DEFAULT_ALLOWED_ORIGINS)


CORS_ALLOWED_ORIGINS = parse_allowed_origins()
ACCESS_TOKEN_TTL_MINUTES = env_int("ACCESS_TOKEN_TTL_MINUTES", 15, 5)
REFRESH_TOKEN_TTL_DAYS = env_int("REFRESH_TOKEN_TTL_DAYS", 30, 1)
PASSWORD_MIN_LENGTH = env_int("MIN_PASSWORD_LENGTH", 6, 6)
RATE_LIMIT_BUCKETS: defaultdict[str, deque[float]] = defaultdict(deque)
RATE_LIMIT_LOCK = Lock()

CORS(
    app,
    resources={
        r"/*": {
            "origins": CORS_ALLOWED_ORIGINS,
            "methods": ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
            "allow_headers": ["Authorization", "Content-Type"],
            "max_age": 600,
        }
    },
)

STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_PRICE_ID = os.environ.get("STRIPE_PRICE_ID", "")
STRIPE_PRICE_ID_INDEPENDENT_MONTHLY = os.environ.get(
    "STRIPE_PRICE_ID_INDEPENDENT_MONTHLY", ""
)
STRIPE_PRICE_ID_INDEPENDENT_YEARLY = os.environ.get(
    "STRIPE_PRICE_ID_INDEPENDENT_YEARLY", ""
)
STRIPE_PRICE_ID_POWER_USER_MONTHLY = os.environ.get(
    "STRIPE_PRICE_ID_POWER_USER_MONTHLY", ""
)
STRIPE_PRICE_ID_POWER_USER_YEARLY = os.environ.get(
    "STRIPE_PRICE_ID_POWER_USER_YEARLY", ""
)
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
JWT_SECRET = os.environ.get("JWT_SECRET", "")
ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "")
ADMIN_TOKEN_SECRET = os.environ.get("ADMIN_TOKEN_SECRET", "")
ADMIN_TOKEN_AUDIENCE = os.environ.get("ADMIN_TOKEN_AUDIENCE", "vocalype-admin")
ADMIN_TOKEN_MAX_AGE_SECONDS = env_int("ADMIN_TOKEN_MAX_AGE_SECONDS", 300, 60)
LICENSE_GRANT_TTL_SECONDS = env_int("LICENSE_GRANT_TTL_SECONDS", 3600, 300)
LICENSE_OFFLINE_TTL_SECONDS = env_int("LICENSE_OFFLINE_TTL_SECONDS", 72 * 3600, 3600)
LICENSE_REFRESH_INTERVAL_SECONDS = env_int("LICENSE_REFRESH_INTERVAL_SECONDS", 20 * 60, 300)
LICENSE_REVOCATION_GRACE_SECONDS = env_int(
    "LICENSE_REVOCATION_GRACE_SECONDS", 24 * 3600, 3600
)
LICENSE_AUDIENCE = os.environ.get("LICENSE_AUDIENCE", "vocalype-license")
LICENSE_ISSUER = os.environ.get("LICENSE_ISSUER", "vocalype-backend")
LICENSE_STRICT_BUILD_APPROVAL = env_bool("LICENSE_STRICT_BUILD_APPROVAL", False)
LICENSE_ALLOW_DEBUG_BUILDS = env_bool("LICENSE_ALLOW_DEBUG_BUILDS", True)
LICENSE_ALLOWED_CHANNELS = {
    item.strip()
    for item in os.environ.get("LICENSE_ALLOWED_CHANNELS", "stable,dev").split(",")
    if item.strip()
}
LICENSE_APPROVED_BUILD_HASHES = {
    item.strip().lower()
    for item in os.environ.get("LICENSE_APPROVED_BUILD_HASHES", "").split(",")
    if item.strip()
}
APP_RETURN_URL = os.environ.get(
    "APP_RETURN_URL",
    os.environ.get("FRONTEND_URL", "https://vocalype.com"),
)
DATABASE_URL = os.environ.get("DATABASE_URL", "")
DB_CONNECT_TIMEOUT_SECONDS = env_int("DB_CONNECT_TIMEOUT_SECONDS", 5, 1)
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
CLOUD_LLM_MODEL = os.environ.get("CLOUD_LLM_MODEL", "llama-3.1-8b-instant")
CLOUD_LLM_ALLOWED_MODELS = [
    model.strip()
    for model in os.environ.get("CLOUD_LLM_ALLOWED_MODELS", CLOUD_LLM_MODEL).split(",")
    if model.strip()
]
CLOUD_LLM_RATE_LIMIT_PER_HOUR = env_int("CLOUD_LLM_RATE_LIMIT_PER_HOUR", 300, 10)
AUTH_TIMING_ENABLED = env_bool("AUTH_TIMING_ENABLED", True)

# Ed25519 private key for signing license bundles.
# Set LICENSE_SIGNING_KEY in Railway env vars (base64-encoded 32-byte seed).
# If missing, bundles are issued unsigned (clients in enforcement mode will reject them).
_LICENSE_SIGNING_KEY_B64 = os.environ.get("LICENSE_SIGNING_KEY", "")
_LICENSE_PRIVATE_KEY: Ed25519PrivateKey | None = None
if _LICENSE_SIGNING_KEY_B64:
    try:
        _seed = base64.b64decode(_LICENSE_SIGNING_KEY_B64)
        _LICENSE_PRIVATE_KEY = Ed25519PrivateKey.from_private_bytes(_seed)
    except Exception as _e:
        print(f"[WARN] Failed to load LICENSE_SIGNING_KEY: {_e}", flush=True)


def _sign_bundle(bundle: dict) -> dict:
    """Add an Ed25519 bundle_signature field to a license bundle dict.

    The signature covers the bundle JSON with all keys sorted alphabetically
    and no spaces — this must exactly match the Rust client's sorted_json_string().
    If no private key is configured, the bundle is returned unsigned.
    """
    if _LICENSE_PRIVATE_KEY is None:
        return bundle

    # Remove any existing signature before signing.
    clean = {k: v for k, v in bundle.items() if k != "bundle_signature"}

    # Deterministic serialisation — must match Rust's sorted_json_string().
    payload = json.dumps(clean, sort_keys=True, separators=(",", ":"))

    signature = _LICENSE_PRIVATE_KEY.sign(payload.encode("utf-8"))
    return {**clean, "bundle_signature": base64.b64encode(signature).decode("utf-8")}
TRUST_X_FORWARDED_FOR = os.environ.get("TRUST_X_FORWARDED_FOR", "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}

stripe.api_key = STRIPE_SECRET_KEY
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024

STRIPE_PRICE_IDS: dict[tuple[str, str], str] = {
    ("independent", "monthly"): STRIPE_PRICE_ID_INDEPENDENT_MONTHLY,
    ("independent", "yearly"): STRIPE_PRICE_ID_INDEPENDENT_YEARLY,
    ("power_user", "monthly"): STRIPE_PRICE_ID_POWER_USER_MONTHLY,
    ("power_user", "yearly"): STRIPE_PRICE_ID_POWER_USER_YEARLY,
}
STRIPE_DEFAULT_CHECKOUT_ORDER: tuple[tuple[str, str], ...] = (
    ("power_user", "monthly"),
    ("independent", "monthly"),
    ("power_user", "yearly"),
    ("independent", "yearly"),
)

FORGOT_PASSWORD_LIMITS = (
    ("forgot_password:ip", 5, 900, 1800),
    ("forgot_password:email", 3, 900, 1800),
)
RESET_VERIFY_LIMITS = (
    ("verify_reset:ip", 10, 900, 1800),
    ("verify_reset:email", 5, 900, 1800),
)
RESET_PASSWORD_LIMITS = (
    ("reset_password:ip", 10, 900, 1800),
    ("reset_password:email", 5, 900, 1800),
)
MAX_RESET_TOKEN_ATTEMPTS = 5
ENTITLEMENT_STATUS_ACTIVE = "active"
ENTITLEMENT_STATUS_REVOCATION_PENDING = "revocation_pending"
ENTITLEMENT_STATUS_REVOKED = "revoked"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def resolved_client_ip() -> str:
    if TRUST_X_FORWARDED_FOR:
        forwarded_for = request.headers.get("X-Forwarded-For", "")
        if forwarded_for:
            forwarded_ip = forwarded_for.split(",")[0].strip()
            if forwarded_ip:
                return forwarded_ip
    return request.remote_addr or "unknown"


def client_ip() -> str:
    return resolved_client_ip()


def request_client_ip() -> str:
    return resolved_client_ip()


def log_security_event(event: str, **fields) -> None:
    rendered_fields = " ".join(
        f"{key}={value}" for key, value in fields.items() if value not in (None, "")
    )
    if rendered_fields:
        app.logger.warning("security_event=%s %s", event, rendered_fields)
    else:
        app.logger.warning("security_event=%s", event)


@contextmanager
def timed_block(scope: str, stage: str, **fields):
    started_at = time.perf_counter()
    try:
        yield
    finally:
        if AUTH_TIMING_ENABLED:
            duration_ms = round((time.perf_counter() - started_at) * 1000, 1)
            rendered_fields = " ".join(
                f"{key}={value}" for key, value in fields.items() if value not in (None, "")
            )
            if rendered_fields:
                app.logger.warning(
                    "perf scope=%s stage=%s duration_ms=%s %s",
                    scope,
                    stage,
                    duration_ms,
                    rendered_fields,
                )
            else:
                app.logger.warning(
                    "perf scope=%s stage=%s duration_ms=%s",
                    scope,
                    stage,
                    duration_ms,
                )


def normalize_email(value: str) -> str:
    return value.strip().lower()


def require_json_string(data: dict, field: str, *, required: bool = True) -> tuple[str | None, object | None]:
    value = data.get(field, "")
    if value is None and not required:
        return None, None
    if not isinstance(value, str):
        return None, (jsonify({"error": f"Champ invalide: {field}"}), 400)
    stripped = value.strip()
    if required and not stripped:
        return None, (jsonify({"error": f"Champ invalide: {field}"}), 400)
    return stripped, None


def optional_json_string(data: dict, field: str) -> tuple[str | None, object | None]:
    value, error = require_json_string(data, field, required=False)
    if error:
        return None, error
    return value or None, None


def require_json_int(data: dict, field: str) -> tuple[int | None, object | None]:
    value = data.get(field)
    if value is None:
        return None, (jsonify({"error": f"Champ requis: {field}"}), 400)
    try:
        return int(str(value).strip()), None
    except (TypeError, ValueError):
        return None, (jsonify({"error": f"Champ invalide: {field}"}), 400)


def email_is_valid(email: str) -> bool:
    return bool(EMAIL_REGEX.fullmatch(email))


def password_validation_error(password: str) -> str | None:
    if len(password) < PASSWORD_MIN_LENGTH:
        return (
            f"Mot de passe trop court (minimum {PASSWORD_MIN_LENGTH} caractères)"
        )

    return None


def device_id_is_valid(device_id: str | None) -> bool:
    if not device_id:
        return True
    normalized = device_id.strip().lower()
    if re.fullmatch(r"[a-f0-9]{64}", normalized):
        return True
    try:
        uuid.UUID(device_id)
        return True
    except ValueError:
        return False


def device_id_is_stable(device_id: str | None) -> bool:
    if not device_id:
        return False
    normalized = device_id.strip().lower()
    return bool(re.fullmatch(r"[a-f0-9]{64}", normalized))


def consume_rate_limit(bucket: str, limit: int, window_seconds: int) -> int | None:
    now = time.time()
    oldest_allowed = now - window_seconds

    with RATE_LIMIT_LOCK:
        attempts = RATE_LIMIT_BUCKETS[bucket]
        while attempts and attempts[0] <= oldest_allowed:
            attempts.popleft()

        if len(attempts) >= limit:
            retry_after = max(1, int(window_seconds - (now - attempts[0])))
            return retry_after

        attempts.append(now)

    return None


def rate_limit_response(
    bucket: str,
    *,
    limit: int,
    window_seconds: int,
    message: str,
):
    retry_after = consume_rate_limit(bucket, limit, window_seconds)
    if retry_after is None:
        return None

    log_security_event(
        "rate_limit_triggered",
        bucket=bucket,
        ip=client_ip(),
        retry_after=retry_after,
    )
    response = jsonify({"error": message})
    response.status_code = 429
    response.headers["Retry-After"] = str(retry_after)
    return response


def to_iso(value: int | None) -> str | None:
    if not value:
        return None
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


def dt_to_iso(value: datetime | None) -> str | None:
    if not value:
        return None
    return value.astimezone(timezone.utc).isoformat()


class _PgConn:
    """Thin wrapper around psycopg2 that mimics the sqlite3 connection API."""

    def __init__(self):
        self._conn = psycopg2.connect(
            DATABASE_URL,
            connect_timeout=DB_CONNECT_TIMEOUT_SECONDS,
        )
        self._conn.autocommit = False
        self._cur = self._conn.cursor(cursor_factory=RealDictCursor)

    def execute(self, sql, params=None):
        self._cur.execute(sql, params)
        return self._cur

    def commit(self):
        self._conn.commit()

    def close(self):
        self._cur.close()
        self._conn.close()


def get_db() -> _PgConn:
    return _PgConn()


def column_exists(db: _PgConn, table_name: str, column_name: str) -> bool:
    rows = db.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name = %s AND column_name = %s",
        (table_name, column_name),
    ).fetchall()
    return len(rows) > 0


def ensure_column(
    db: _PgConn,
    table_name: str,
    column_name: str,
    definition: str,
) -> None:
    if not column_exists(db, table_name, column_name):
        db.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")


def init_db():
    db = get_db()
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            name TEXT,
            password_hash TEXT NOT NULL,
            stripe_customer_id TEXT,
            subscription_status TEXT DEFAULT 'inactive',
            trial_end TEXT,
            period_end TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS device_registrations (
            id SERIAL PRIMARY KEY,
            device_id TEXT UNIQUE NOT NULL,
            user_id INTEGER NOT NULL,
            registered_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            expires_at TEXT NOT NULL,
            used INTEGER DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS auth_rate_limits (
            key TEXT PRIMARY KEY,
            attempts INTEGER NOT NULL DEFAULT 0,
            window_started_at TEXT NOT NULL,
            blocked_until TEXT
        )
        """
    )
    ensure_column(db, "password_reset_tokens", "attempt_count", "INTEGER NOT NULL DEFAULT 0")
    ensure_column(db, "users", "token_version", "INTEGER NOT NULL DEFAULT 0")
    ensure_column(db, "users", "weekly_transcription_count", "INTEGER NOT NULL DEFAULT 0")
    ensure_column(db, "users", "weekly_transcription_reset_at", "TEXT")
    ensure_column(db, "users", "trial_reminder_sent", "INTEGER NOT NULL DEFAULT 0")
    ensure_column(db, "users", "subscription_plan", "TEXT")
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS premium_device_entitlements (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            device_id TEXT NOT NULL,
            plan TEXT NOT NULL DEFAULT 'premium',
            entitlement_status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            last_seen_at TEXT,
            last_grant_issued_at TEXT,
            revoked_at TEXT,
            grace_until TEXT,
            app_version TEXT,
            app_channel TEXT,
            UNIQUE(user_id, device_id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS license_integrity_events (
            id SERIAL PRIMARY KEY,
            user_id INTEGER,
            device_id TEXT,
            event_type TEXT NOT NULL,
            details TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS referrals (
            id SERIAL PRIMARY KEY,
            referrer_id INTEGER NOT NULL,
            referee_id INTEGER NOT NULL,
            converted INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (referrer_id) REFERENCES users(id),
            FOREIGN KEY (referee_id) REFERENCES users(id)
        )
        """
    )
    ensure_column(db, "users", "referral_code", "TEXT")
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS organizations (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            billing_contact_email TEXT NOT NULL,
            support_contact_email TEXT NOT NULL,
            seats_included INTEGER NOT NULL DEFAULT 5,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS organization_members (
            id SERIAL PRIMARY KEY,
            organization_id INTEGER NOT NULL,
            user_id INTEGER,
            email TEXT NOT NULL,
            name TEXT,
            role TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'invited',
            invited_by_user_id INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            accepted_at TEXT,
            UNIQUE(organization_id, email),
            FOREIGN KEY (organization_id) REFERENCES organizations(id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (invited_by_user_id) REFERENCES users(id)
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS organization_templates (
            id SERIAL PRIMARY KEY,
            organization_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            prompt TEXT NOT NULL,
            created_by_user_id INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (organization_id) REFERENCES organizations(id),
            FOREIGN KEY (created_by_user_id) REFERENCES users(id)
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS organization_snippets (
            id SERIAL PRIMARY KEY,
            organization_id INTEGER NOT NULL,
            trigger TEXT NOT NULL,
            expansion TEXT NOT NULL,
            created_by_user_id INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (organization_id) REFERENCES organizations(id),
            FOREIGN KEY (created_by_user_id) REFERENCES users(id)
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS organization_dictionary_terms (
            id SERIAL PRIMARY KEY,
            organization_id INTEGER NOT NULL,
            term TEXT NOT NULL,
            note TEXT,
            created_by_user_id INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (organization_id) REFERENCES organizations(id),
            FOREIGN KEY (created_by_user_id) REFERENCES users(id)
        )
        """
    )
    db.commit()
    db.close()


if not env_bool("SKIP_DB_INIT", False):
    init_db()


def make_token(user) -> str:
    payload = {
        "user_id": user["id"],
        "ver": int(user["token_version"] or 0),
        "exp": utc_now() + timedelta(minutes=ACCESS_TOKEN_TTL_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def make_refresh_token(user) -> str:
    payload = {
        "user_id": user["id"],
        "ver": int(user["token_version"] or 0),
        "type": "refresh",
        "exp": utc_now() + timedelta(days=REFRESH_TOKEN_TTL_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def load_user_by_id(user_id: int, db: _PgConn | None = None):
    owns_db = db is None
    if db is None:
        db = get_db()
    try:
        return db.execute("SELECT * FROM users WHERE id = %s", (user_id,)).fetchone()
    finally:
        if owns_db:
            db.close()


def load_user_by_email(email: str, db: _PgConn | None = None):
    owns_db = db is None
    if db is None:
        db = get_db()
    try:
        return db.execute("SELECT * FROM users WHERE email = %s", (email,)).fetchone()
    finally:
        if owns_db:
            db.close()


def record_license_integrity_event(
    *,
    event_type: str,
    user_id: int | None,
    device_id: str | None,
    details: dict | None = None,
) -> None:
    db = get_db()
    try:
        db.execute(
            """
            INSERT INTO license_integrity_events (user_id, device_id, event_type, details)
            VALUES (%s, %s, %s, %s)
            """,
            (
                user_id,
                device_id,
                event_type,
                None if details is None else str(details),
            ),
        )
        db.commit()
    finally:
        db.close()


def issue_signed_token(payload: dict, expires_at: datetime) -> str:
    token_payload = {
        **payload,
        "iss": LICENSE_ISSUER,
        "aud": LICENSE_AUDIENCE,
        "iat": int(time.time()),
        "exp": expires_at,
    }
    return jwt.encode(token_payload, JWT_SECRET, algorithm="HS256")


def load_device_entitlement(user_id: int, device_id: str):
    db = get_db()
    try:
        return db.execute(
            """
            SELECT * FROM premium_device_entitlements
            WHERE user_id = %s AND device_id = %s
            """,
            (user_id, device_id),
        ).fetchone()
    finally:
        db.close()


def bootstrap_device_entitlement(
    user,
    device_id: str,
    app_version: str | None = None,
    app_channel: str | None = None,
):
    if not device_id or not has_access(user):
        return load_device_entitlement(user["id"], device_id)

    now_iso = dt_to_iso(utc_now())
    db = get_db()
    try:
        db.execute(
            """
            INSERT INTO premium_device_entitlements (
                user_id,
                device_id,
                plan,
                entitlement_status,
                created_at,
                last_seen_at,
                last_grant_issued_at,
                app_version,
                app_channel
            ) VALUES (%s, %s, 'premium', %s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id, device_id) DO NOTHING
            """,
            (
                user["id"],
                device_id,
                ENTITLEMENT_STATUS_ACTIVE,
                now_iso,
                now_iso,
                now_iso,
                app_version,
                app_channel,
            ),
        )
        db.execute(
            """
            UPDATE premium_device_entitlements
            SET plan = 'premium',
                entitlement_status = %s,
                last_seen_at = %s,
                last_grant_issued_at = %s,
                revoked_at = NULL,
                grace_until = NULL,
                app_version = COALESCE(%s, app_version),
                app_channel = COALESCE(%s, app_channel)
            WHERE user_id = %s AND device_id = %s
            """,
            (
                ENTITLEMENT_STATUS_ACTIVE,
                now_iso,
                now_iso,
                app_version,
                app_channel,
                user["id"],
                device_id,
            ),
        )
        db.commit()
        return db.execute(
            """
            SELECT * FROM premium_device_entitlements
            WHERE user_id = %s AND device_id = %s
            """,
            (user["id"], device_id),
        ).fetchone()
    finally:
        db.close()


def sync_device_entitlement_state(
    user,
    device_id: str,
    *,
    app_version: str | None = None,
    app_channel: str | None = None,
    db: _PgConn | None = None,
    workspace_row=None,
):
    if not device_id:
        return None

    owns_db = db is None
    if db is None:
        db = get_db()
    try:
        now = utc_now()
        now_iso = dt_to_iso(now)
        row = db.execute(
            """
            SELECT * FROM premium_device_entitlements
            WHERE user_id = %s AND device_id = %s
            """,
            (user["id"], device_id),
        ).fetchone()

        tier = get_user_tier(user, workspace_row=workspace_row)
        if row is None:
            db.execute(
                """
                INSERT INTO premium_device_entitlements (
                    user_id,
                    device_id,
                    plan,
                    entitlement_status,
                    created_at,
                    last_seen_at,
                    last_grant_issued_at,
                    app_version,
                    app_channel
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    user["id"],
                    device_id,
                    tier,
                    ENTITLEMENT_STATUS_ACTIVE,
                    now_iso,
                    now_iso,
                    now_iso,
                    app_version,
                    app_channel,
                ),
            )
        else:
            db.execute(
                """
                UPDATE premium_device_entitlements
                SET plan = %s,
                    entitlement_status = %s,
                    last_seen_at = %s,
                    last_grant_issued_at = %s,
                    revoked_at = NULL,
                    grace_until = NULL,
                    app_version = COALESCE(%s, app_version),
                    app_channel = COALESCE(%s, app_channel)
                WHERE id = %s
                """,
                (
                    tier,
                    ENTITLEMENT_STATUS_ACTIVE,
                    now_iso,
                    now_iso,
                    app_version,
                    app_channel,
                    row["id"],
                ),
            )
        db.commit()
        return db.execute(
            """
            SELECT * FROM premium_device_entitlements
            WHERE user_id = %s AND device_id = %s
            """,
            (user["id"], device_id),
        ).fetchone()
    finally:
        if owns_db:
            db.close()


def sync_all_entitlements_for_user(user_id: int) -> None:
    user = load_user_by_id(user_id)
    if not user:
        return

    db = get_db()
    try:
        device_rows = db.execute(
            "SELECT device_id FROM premium_device_entitlements WHERE user_id = %s",
            (user_id,),
        ).fetchall()
    finally:
        db.close()

    for row in device_rows:
        sync_device_entitlement_state(user, row["device_id"])


def entitlement_allows_access(entitlement) -> bool:
    if entitlement is None:
        return False
    status = entitlement["entitlement_status"] or ENTITLEMENT_STATUS_ACTIVE
    if status == ENTITLEMENT_STATUS_ACTIVE:
        return True
    if status == ENTITLEMENT_STATUS_REVOCATION_PENDING:
        grace_until = parse_iso(entitlement["grace_until"])
        return bool(grace_until and grace_until > utc_now())
    return False


def evaluate_build_integrity(
    *,
    user,
    device_id: str,
    app_channel: str | None,
    integrity: dict | None,
):
    integrity = integrity or {}
    anomalies: list[str] = []
    binary_sha256 = str(integrity.get("binary_sha256", "")).strip().lower() or None
    release_build = bool(integrity.get("release_build", False))
    raw_tamper_flags = integrity.get("tamper_flags") or []
    is_dev_channel = (app_channel or "").strip().lower() == "dev"

    if app_channel and LICENSE_ALLOWED_CHANNELS and app_channel not in LICENSE_ALLOWED_CHANNELS:
        anomalies.append(f"channel_not_allowed:{app_channel}")

    if not release_build and not LICENSE_ALLOW_DEBUG_BUILDS:
        anomalies.append("debug_build_disallowed")

    for item in raw_tamper_flags:
        value = str(item).strip()
        if value:
            if is_dev_channel and value in {"debug_build", "debug_path"}:
                continue
            anomalies.append(f"tamper_flag:{value}")

    if LICENSE_APPROVED_BUILD_HASHES and binary_sha256 not in LICENSE_APPROVED_BUILD_HASHES:
        anomalies.append("unapproved_binary_hash")

    if anomalies:
        log_security_event(
            "license_integrity_anomaly",
            user_id=user["id"],
            device_id=device_id,
            anomalies=",".join(anomalies),
            app_channel=app_channel,
            binary_sha256=binary_sha256,
        )
        record_license_integrity_event(
            event_type="license_integrity_anomaly",
            user_id=user["id"],
            device_id=device_id,
            details={
                "anomalies": anomalies,
                "app_channel": app_channel,
                "binary_sha256": binary_sha256,
                "release_build": release_build,
            },
        )

    blocked = LICENSE_STRICT_BUILD_APPROVAL and bool(anomalies)
    return {
        "binary_sha256": binary_sha256,
        "release_build": release_build,
        "anomalies": anomalies,
        "blocked": blocked,
    }


def build_license_payloads(user, entitlement, *, device_id: str, integrity_evaluation: dict | None = None):
    now = utc_now()
    grant_expires_at = now + timedelta(seconds=LICENSE_GRANT_TTL_SECONDS)
    offline_expires_at = now + timedelta(seconds=LICENSE_OFFLINE_TTL_SECONDS)
    grace_until = parse_iso(entitlement["grace_until"]) if entitlement else None

    if grace_until:
        if grace_until < grant_expires_at:
            grant_expires_at = grace_until
        if grace_until < offline_expires_at:
            offline_expires_at = grace_until

    status = entitlement["entitlement_status"] if entitlement else ENTITLEMENT_STATUS_REVOKED
    plan = entitlement["plan"] if entitlement else "premium"
    entitlements = ["premium"] if entitlement_allows_access(entitlement) else []
    app_version = entitlement["app_version"] if entitlement else None
    app_channel = entitlement["app_channel"] if entitlement else None

    issued_at_iso = dt_to_iso(now)
    grant_expires_at_iso = dt_to_iso(grant_expires_at)
    offline_expires_at_iso = dt_to_iso(offline_expires_at)
    grace_until_iso = dt_to_iso(grace_until)
    model_unlock_key = hashlib.sha256(
        "|".join(
            [
                "vocalype-model-unlock-v1",
                JWT_SECRET,
                str(user["id"]),
                device_id,
                plan,
                status,
                offline_expires_at_iso or "",
            ]
        ).encode("utf-8")
    ).hexdigest()

    grant_payload = {
        "type": "license_grant",
        "sub": str(user["id"]),
        "user_id": str(user["id"]),
        "device_id": device_id,
        "plan": plan,
        "entitlements": entitlements,
        "entitlement_status": status,
        "app_version": app_version,
        "app_channel": app_channel,
        "grace_until": grace_until_iso,
        "model_unlock_key": model_unlock_key,
    }
    offline_payload = {
        "type": "offline_cache",
        "sub": str(user["id"]),
        "user_id": str(user["id"]),
        "device_id": device_id,
        "plan": plan,
        "entitlements": entitlements,
        "entitlement_status": status,
        "app_version": app_version,
        "app_channel": app_channel,
        "grace_until": grace_until_iso,
        "last_validated_at": issued_at_iso,
        "model_unlock_key": model_unlock_key,
    }

    bundle = {
        "state": "online_valid" if entitlements else "expired",
        "issued_at": issued_at_iso,
        "grant_token": issue_signed_token(grant_payload, grant_expires_at),
        "grant_expires_at": grant_expires_at_iso,
        "offline_token": issue_signed_token(offline_payload, offline_expires_at),
        "offline_expires_at": offline_expires_at_iso,
        "refresh_after_seconds": LICENSE_REFRESH_INTERVAL_SECONDS,
        "device_id": device_id,
        "plan": plan,
        "entitlements": entitlements,
        "entitlement_status": status,
        "grace_until": grace_until_iso,
        "model_unlock_key": model_unlock_key,
        "build_binding_sha256": (integrity_evaluation or {}).get("binary_sha256"),
        "integrity_anomalies": (integrity_evaluation or {}).get("anomalies", []),
    }
    # Sign the bundle so the desktop client can verify it wasn't tampered with.
    return _sign_bundle(bundle)


def build_license_status_response(user, entitlement, *, device_id: str):
    tier = get_user_tier(user)
    entitlement_ok = entitlement_allows_access(entitlement)
    # Both tiers are valid — basic users still get an online_valid license
    state = "online_valid" if entitlement_ok else "expired"
    plan = tier  # "premium" or "basic"
    entitlements = [plan] if entitlement_ok else []
    return {
        "state": state,
        "device_id": device_id,
        "user_id": str(user["id"]),
        "subscription_status": user["subscription_status"],
        "subscription_has_access": True,
        "entitlement_status": (
            entitlement["entitlement_status"] if entitlement else ENTITLEMENT_STATUS_REVOKED
        ),
        "plan": plan,
        "grace_until": dt_to_iso(parse_iso(entitlement["grace_until"])) if entitlement else None,
        "grant_expires_at": None,
        "offline_expires_at": None,
        "entitlements": entitlements,
    }


def device_is_registered(device_id: str) -> bool:
    if not device_id:
        return False
    db = get_db()
    try:
        row = db.execute(
            "SELECT id FROM device_registrations WHERE device_id = %s",
            (device_id,),
        ).fetchone()
        return row is not None
    finally:
        db.close()


def register_device(device_id: str, user_id: int, db: _PgConn | None = None) -> None:
    if not device_id:
        return
    owns_db = db is None
    if db is None:
        db = get_db()
    try:
        db.execute(
            "INSERT INTO device_registrations (device_id, user_id) VALUES (%s, %s) ON CONFLICT (device_id) DO NOTHING",
            (device_id, user_id),
        )
        db.commit()
    finally:
        if owns_db:
            db.close()


def get_current_user():
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None

    try:
        payload = jwt.decode(auth[7:], JWT_SECRET, algorithms=["HS256"])
    except Exception:
        return None

    user = load_user_by_id(payload.get("user_id"))
    if not user:
        return None

    try:
        token_version = int(user["token_version"] or 0)
        claimed_version = int(payload.get("ver", 0))
    except (TypeError, ValueError):
        return None

    if claimed_version != token_version:
        return None

    return user


def parse_iso(value: str | None):
    if not value:
        return None

    try:
        normalized = value.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def get_client_ip() -> str:
    return resolved_client_ip()


def normalize_rate_limit_key(scope: str, identifier: str) -> str:
    return f"{scope}:{identifier.strip().lower()}"


def check_rate_limit(
    scope: str,
    identifier: str,
    *,
    max_attempts: int,
    window_seconds: int,
    block_seconds: int,
    increment: bool,
) -> Optional[int]:
    key = normalize_rate_limit_key(scope, identifier)
    now = utc_now()

    db = get_db()
    try:
        row = db.execute(
            "SELECT * FROM auth_rate_limits WHERE key = %s",
            (key,),
        ).fetchone()

        if not row:
            if increment:
                db.execute(
                    """
                    INSERT INTO auth_rate_limits (key, attempts, window_started_at, blocked_until)
                    VALUES (%s, %s, %s, NULL)
                    """,
                    (key, 1, now.isoformat()),
                )
                db.commit()
            return None

        blocked_until = parse_iso(row["blocked_until"])
        if blocked_until and now < blocked_until:
            return max(1, int((blocked_until - now).total_seconds()))

        window_started_at = parse_iso(row["window_started_at"]) or now
        attempts = int(row["attempts"] or 0)

        if now - window_started_at >= timedelta(seconds=window_seconds):
            attempts = 0
            window_started_at = now

        if increment:
            attempts += 1

        if attempts > max_attempts:
            blocked_until = now + timedelta(seconds=block_seconds)
            db.execute(
                """
                UPDATE auth_rate_limits
                SET attempts = %s, window_started_at = %s, blocked_until = %s
                WHERE key = %s
                """,
                (attempts, window_started_at.isoformat(), blocked_until.isoformat(), key),
            )
            db.commit()
            return block_seconds

        db.execute(
            """
            UPDATE auth_rate_limits
            SET attempts = %s, window_started_at = %s, blocked_until = NULL
            WHERE key = %s
            """,
            (attempts, window_started_at.isoformat(), key),
        )
        db.commit()
        return None
    finally:
        db.close()


def clear_rate_limit(scope: str, identifier: str) -> None:
    key = normalize_rate_limit_key(scope, identifier)
    db = get_db()
    try:
        db.execute("DELETE FROM auth_rate_limits WHERE key = %s", (key,))
        db.commit()
    finally:
        db.close()


def enforce_rate_limits(
    *checks: tuple[str, str, int, int, int], increment: bool
) -> Optional[int]:
    for scope, identifier, max_attempts, window_seconds, block_seconds in checks:
        retry_after = check_rate_limit(
            scope,
            identifier,
            max_attempts=max_attempts,
            window_seconds=window_seconds,
            block_seconds=block_seconds,
            increment=increment,
        )
        if retry_after:
            return retry_after
    return None


def scoped_limits(base_identifier: str, limits: tuple[tuple[str, int, int, int], ...]):
    return tuple(
        (scope, base_identifier, max_attempts, window_seconds, block_seconds)
        for scope, max_attempts, window_seconds, block_seconds in limits
    )


BASIC_WEEKLY_TRANSCRIPTION_LIMIT = 30
SUPPORTED_BILLING_PLANS = {"independent", "power_user", "small_agency"}
WORKSPACE_DEFAULT_SEATS = 5
WORKSPACE_DEFAULT_SUPPORT_EMAIL = "priority@vocalype.com"


def get_user_tier(user, workspace_row=None) -> str:
    """Returns 'premium' or 'basic'. Never returns a hard-blocked state."""
    if workspace_row is None:
        workspace_row = get_user_workspace_row(user)
    if workspace_row is not None:
        return "premium"
    status = user["subscription_status"]
    if status == "active":
        return "premium"
    if status == "trialing":
        trial_end = parse_iso(user["trial_end"])
        if trial_end and utc_now() < trial_end:
            return "premium"
    return "basic"


def normalize_billing_plan(value: str | None) -> str | None:
    if not value:
        return None
    normalized = value.strip().lower()
    return normalized if normalized in SUPPORTED_BILLING_PLANS else None


def get_user_plan(user, workspace_row=None) -> str | None:
    if workspace_row is None:
        workspace_row = get_user_workspace_row(user)
    if workspace_row is not None:
        return "small_agency"
    if get_user_tier(user, workspace_row=workspace_row) != "premium":
        return None
    return normalize_billing_plan(user.get("subscription_plan")) or "power_user"


def has_small_agency_access(user) -> bool:
    return get_user_plan(user) == "small_agency"


def has_access(user) -> bool:
    """True for all registered users — both premium and basic."""
    return True


def has_premium_access(user) -> bool:
    return get_user_tier(user) == "premium"


def get_weekly_quota(user) -> dict:
    """Returns current week's transcription usage for basic users."""
    now = utc_now()
    reset_at = parse_iso(user.get("weekly_transcription_reset_at"))
    count = int(user.get("weekly_transcription_count") or 0)

    # Reset counter if the window has passed (rolling 7-day window)
    if reset_at is None or now >= reset_at:
        count = 0

    return {
        "count": count,
        "limit": BASIC_WEEKLY_TRANSCRIPTION_LIMIT,
        "remaining": max(0, BASIC_WEEKLY_TRANSCRIPTION_LIMIT - count),
        "reset_at": dt_to_iso(reset_at) if reset_at and now < reset_at else None,
    }


def load_workspace_row_for_user(user_id: int, db: _PgConn | None = None):
    owns_db = db is None
    if db is None:
        db = get_db()
    try:
        return db.execute(
            """
            SELECT
                o.*,
                om.id AS membership_id,
                om.role AS current_user_role,
                om.status AS current_user_status
            FROM organizations o
            JOIN organization_members om
              ON om.organization_id = o.id
            WHERE om.user_id = %s
            ORDER BY o.id ASC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()
    finally:
        if owns_db:
            db.close()


def get_user_workspace_row(user):
    if user is None:
        return None
    if "__workspace_row_loaded__" in user:
        return user.get("__workspace_row__")
    workspace_row = load_workspace_row_for_user(user["id"])
    user["__workspace_row_loaded__"] = True
    user["__workspace_row__"] = workspace_row
    return workspace_row


def user_has_small_agency_membership(user_id: int) -> bool:
    return load_workspace_row_for_user(user_id) is not None


def attach_user_to_pending_workspace_invites(user, db: _PgConn | None = None) -> None:
    owns_db = db is None
    if db is None:
        db = get_db()
    try:
        db.execute(
            """
            UPDATE organization_members
            SET user_id = %s,
                status = 'active',
                accepted_at = COALESCE(accepted_at, %s),
                name = COALESCE(name, %s)
            WHERE user_id IS NULL
              AND email = %s
            """,
            (
                user["id"],
                dt_to_iso(utc_now()),
                user.get("name") or user["email"].split("@")[0],
                user["email"],
            ),
        )
        db.commit()
    finally:
        if owns_db:
            db.close()


def seed_workspace_defaults(db: _PgConn, organization_id: int, user_id: int) -> None:
    default_templates = [
        (
            "Scorecard intake",
            "Standardise les notes d'appel candidat pour toute l'equipe.",
            "Turn the dictated text into a recruiter scorecard for the team. Keep the original language. Structure with: fit, strengths, concerns, compensation, and next step. Return only the final scorecard. Text: ${output}",
        ),
        (
            "Client shortlist update",
            "Resume client partage pour envoyer un shortlist propre.",
            "Transform the dictated text into a concise shortlist update for the client. Keep the original language. Include candidate status, fit, risks, and recommended next step. Return only the final client-ready update. Text: ${output}",
        ),
    ]
    default_snippets = [
        (
            "envoie le debrief",
            "Je t'envoie le debrief complet dans l'heure avec les prochaines etapes.",
        ),
        (
            "shortlist client",
            "Je partage la shortlist client aujourd'hui avec les points de vigilance et la recommandation finale.",
        ),
    ]
    default_terms = [
        ("Greenhouse", "ATS principal de l'equipe"),
        ("scorecard", None),
        ("retained search", None),
    ]

    for name, description, prompt in default_templates:
        db.execute(
            """
            INSERT INTO organization_templates (organization_id, name, description, prompt, created_by_user_id)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (organization_id, name, description, prompt, user_id),
        )
    for trigger, expansion in default_snippets:
        db.execute(
            """
            INSERT INTO organization_snippets (organization_id, trigger, expansion, created_by_user_id)
            VALUES (%s, %s, %s, %s)
            """,
            (organization_id, trigger, expansion, user_id),
        )
    for term, note in default_terms:
        db.execute(
            """
            INSERT INTO organization_dictionary_terms (organization_id, term, note, created_by_user_id)
            VALUES (%s, %s, %s, %s)
            """,
            (organization_id, term, note, user_id),
        )


def ensure_small_agency_workspace(user):
    if not has_small_agency_access(user):
        return None

    existing = get_user_workspace_row(user)
    if existing:
        return existing

    owner_name = (user.get("name") or user["email"].split("@")[0]).strip()
    workspace_name = f"{owner_name.split(' ')[0]}'s agency"
    db = get_db()
    try:
        row = db.execute(
            """
            INSERT INTO organizations (
                name,
                billing_contact_email,
                support_contact_email,
                seats_included
            )
            VALUES (%s, %s, %s, %s)
            RETURNING id
            """,
            (
                workspace_name,
                user["email"],
                WORKSPACE_DEFAULT_SUPPORT_EMAIL,
                WORKSPACE_DEFAULT_SEATS,
            ),
        ).fetchone()
        organization_id = row["id"]
        db.execute(
            """
            INSERT INTO organization_members (
                organization_id,
                user_id,
                email,
                name,
                role,
                status,
                invited_by_user_id,
                accepted_at
            )
            VALUES (%s, %s, %s, %s, 'owner', 'active', %s, %s)
            """,
            (
                organization_id,
                user["id"],
                user["email"],
                owner_name,
                user["id"],
                dt_to_iso(utc_now()),
            ),
        )
        seed_workspace_defaults(db, organization_id, user["id"])
        db.commit()
    finally:
        db.close()

    workspace_row = load_workspace_row_for_user(user["id"])
    user["__workspace_row_loaded__"] = True
    user["__workspace_row__"] = workspace_row
    return workspace_row


def list_workspace_members(organization_id: int, db: _PgConn | None = None) -> list[dict]:
    owns_db = db is None
    if db is None:
        db = get_db()
    try:
        rows = db.execute(
            """
            SELECT id, user_id, email, name, role, status, created_at, accepted_at
            FROM organization_members
            WHERE organization_id = %s
            ORDER BY
                CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                created_at ASC,
                id ASC
            """,
            (organization_id,),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        if owns_db:
            db.close()


def list_workspace_templates(organization_id: int, db: _PgConn | None = None) -> list[dict]:
    owns_db = db is None
    if db is None:
        db = get_db()
    try:
        rows = db.execute(
            """
            SELECT id, name, description, prompt, created_at
            FROM organization_templates
            WHERE organization_id = %s
            ORDER BY created_at ASC, id ASC
            """,
            (organization_id,),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        if owns_db:
            db.close()


def list_workspace_snippets(organization_id: int, db: _PgConn | None = None) -> list[dict]:
    owns_db = db is None
    if db is None:
        db = get_db()
    try:
        rows = db.execute(
            """
            SELECT id, trigger, expansion, created_at
            FROM organization_snippets
            WHERE organization_id = %s
            ORDER BY created_at ASC, id ASC
            """,
            (organization_id,),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        if owns_db:
            db.close()


def list_workspace_dictionary(organization_id: int, db: _PgConn | None = None) -> list[dict]:
    owns_db = db is None
    if db is None:
        db = get_db()
    try:
        rows = db.execute(
            """
            SELECT id, term, note, created_at
            FROM organization_dictionary_terms
            WHERE organization_id = %s
            ORDER BY created_at ASC, id ASC
            """,
            (organization_id,),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        if owns_db:
            db.close()


def serialize_workspace(workspace_row: dict, db: _PgConn | None = None) -> dict:
    organization_id = workspace_row["id"]
    owns_db = db is None
    if db is None:
        db = get_db()
    try:
        members = list_workspace_members(organization_id, db=db)
        templates = list_workspace_templates(organization_id, db=db)
        snippets = list_workspace_snippets(organization_id, db=db)
        dictionary = list_workspace_dictionary(organization_id, db=db)
    finally:
        if owns_db:
            db.close()

    return {
        "id": str(organization_id),
        "name": workspace_row["name"],
        "current_user_role": workspace_row["current_user_role"],
        "seats_included": int(workspace_row["seats_included"] or 0),
        "billing_contact_email": workspace_row["billing_contact_email"],
        "support_contact_email": workspace_row["support_contact_email"],
        "members": [
            {
                "id": str(member["id"]),
                "user_id": str(member["user_id"]) if member.get("user_id") else None,
                "name": member.get("name") or member["email"].split("@")[0],
                "email": member["email"],
                "role": member["role"],
                "status": member["status"],
            }
            for member in members
        ],
        "shared_templates": [
            {
                "id": str(template["id"]),
                "name": template["name"],
                "description": template.get("description") or "",
                "prompt": template["prompt"],
            }
            for template in templates
        ],
        "shared_snippets": [
            {
                "id": str(snippet["id"]),
                "trigger": snippet["trigger"],
                "expansion": snippet["expansion"],
            }
            for snippet in snippets
        ],
        "shared_dictionary": [
            {
                "id": str(term["id"]),
                "term": term["term"],
                "note": term.get("note"),
            }
            for term in dictionary
        ],
    }


def require_small_agency_workspace(user):
    workspace = ensure_small_agency_workspace(user)
    if not workspace:
        return None, (jsonify({"error": "Small agency requis"}), 403)
    return workspace, None


def build_user_response(
    user,
    token: str,
    *,
    refresh_token: str | None = None,
    show_trial_reminder: bool = False,
    workspace_row=None,
    workspace_payload=None,
):
    tier = get_user_tier(user, workspace_row=workspace_row)
    plan = get_user_plan(user, workspace_row=workspace_row)
    is_workspace_managed = plan == "small_agency"
    workspace = workspace_row
    if workspace is None and workspace_payload is None and is_workspace_managed:
        workspace = ensure_small_agency_workspace(user)
    can_manage_billing = bool(user["stripe_customer_id"])
    if is_workspace_managed:
        can_manage_billing = bool(workspace) and workspace["current_user_role"] == "owner" and can_manage_billing
    effective_status = "active" if is_workspace_managed else user["subscription_status"]
    effective_trial_end = None if is_workspace_managed else user["trial_end"]
    effective_period_end = None if is_workspace_managed else user["period_end"]
    response = {
        "token": token,
        "user": {
            "id": str(user["id"]),
            "email": user["email"],
            "name": user["name"] or user["email"].split("@")[0],
        },
        "subscription": {
            "status": effective_status,
            "trial_ends_at": effective_trial_end,
            "current_period_ends_at": effective_period_end,
            "has_access": True,
            "tier": tier,
            "plan": plan,
            "billing_plan": plan,
            "can_manage_billing": can_manage_billing,
        },
    }
    if workspace_payload:
        response["workspace"] = workspace_payload
    elif workspace:
        response["workspace"] = serialize_workspace(workspace)
    if tier == "basic":
        response["subscription"]["quota"] = get_weekly_quota(user)
    if show_trial_reminder and not is_workspace_managed:
        response["show_trial_reminder"] = True
    if refresh_token:
        response["refresh_token"] = refresh_token
    return response


def auth_required(handler):
    @wraps(handler)
    def wrapper(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({"error": "Non autorisé"}), 401
        return handler(user, *args, **kwargs)

    return wrapper


def origin_is_allowed(origin: str) -> bool:
    normalized = origin.strip().rstrip("/")
    if not normalized:
        return False
    return normalized in {item.rstrip("/") for item in CORS_ALLOWED_ORIGINS}


@app.before_request
def enforce_trusted_origins():
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return None

    # Stripe and other server-to-server clients generally do not send Origin.
    # We only enforce the allowlist when the request declares a browser origin.
    if request.path == "/webhook":
        return None

    origin = request.headers.get("Origin", "").strip()
    if not origin:
        return None

    if origin_is_allowed(origin):
        return None

    log_security_event(
        "origin_rejected",
        origin=origin,
        path=request.path,
        ip=client_ip(),
    )
    return jsonify({"error": "Origine non autorisée"}), 403


@app.after_request
def add_security_headers(response):
    response.headers.setdefault("Cache-Control", "no-store")
    response.headers.setdefault("Pragma", "no-cache")
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Cross-Origin-Resource-Policy", "same-site")
    response.headers.setdefault(
        "Permissions-Policy",
        "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=()",
    )
    if request.is_secure or request.headers.get("X-Forwarded-Proto", "").lower() == "https":
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains",
        )
    return response


def require_secret_configured():
    if not JWT_SECRET:
        raise RuntimeError("JWT_SECRET is required")
    if len(JWT_SECRET) < 32:
        raise RuntimeError("JWT_SECRET must be at least 32 characters long")
    if ADMIN_TOKEN_SECRET and len(ADMIN_TOKEN_SECRET) < 32:
        raise RuntimeError("ADMIN_TOKEN_SECRET must be at least 32 characters long")
    if ADMIN_SECRET:
        app.logger.warning(
            "ADMIN_SECRET is deprecated; use short-lived admin JWTs signed with ADMIN_TOKEN_SECRET instead"
        )
    if TRUST_X_FORWARDED_FOR:
        app.logger.warning(
            "TRUST_X_FORWARDED_FOR is enabled. Only use this behind a trusted reverse proxy that rewrites X-Forwarded-For."
        )
    if not STRIPE_WEBHOOK_SECRET and STRIPE_SECRET_KEY:
        app.logger.warning(
            "STRIPE_SECRET_KEY is configured without STRIPE_WEBHOOK_SECRET; webhook verification will fail until both are set."
        )
    if not ADMIN_TOKEN_SECRET:
        app.logger.warning(
            "ADMIN_TOKEN_SECRET is not configured; admin JWT flows are disabled until it is set."
        )


require_secret_configured()


def extract_bearer_token() -> str:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return ""
    return auth_header[7:].strip()


def get_current_admin_subject(required_scope: str) -> str | None:
    token = extract_bearer_token()
    if not token or not ADMIN_TOKEN_SECRET:
        return None

    try:
        payload = jwt.decode(
            token,
            ADMIN_TOKEN_SECRET,
            algorithms=["HS256"],
            audience=ADMIN_TOKEN_AUDIENCE,
            options={"require": ["exp", "iat", "sub", "scope"]},
        )
    except Exception:
        return None

    issued_at = payload.get("iat")
    if not isinstance(issued_at, int):
        return None

    now = int(time.time())
    if issued_at > now + 30:
        return None
    if now - issued_at > ADMIN_TOKEN_MAX_AGE_SECONDS:
        return None

    scope = payload.get("scope", "")
    scopes = {item.strip() for item in str(scope).split() if item.strip()}
    if required_scope not in scopes:
        return None

    subject = str(payload.get("sub", "")).strip()
    return subject or None


def require_billing_configured():
    if not STRIPE_SECRET_KEY:
        raise RuntimeError("STRIPE_SECRET_KEY is required")
    if not STRIPE_PRICE_ID and not any(STRIPE_PRICE_IDS.values()):
        raise RuntimeError(
            "At least one Stripe price id is required "
            "(STRIPE_PRICE_ID or STRIPE_PRICE_ID_*)."
        )
    if not STRIPE_WEBHOOK_SECRET:
        raise RuntimeError("STRIPE_WEBHOOK_SECRET is required")


def append_query_param(url: str, query: str) -> str:
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}{query}"


def resolve_checkout_price_id(plan: str | None = None, interval: str | None = None) -> str:
    normalized_plan = (plan or "").strip().lower()
    normalized_interval = (interval or "").strip().lower()

    if normalized_plan:
        if normalized_plan == "small_agency":
            raise ValueError("Small agency requires sales-assisted checkout")
        resolved_interval = normalized_interval or "monthly"
        price_id = STRIPE_PRICE_IDS.get((normalized_plan, resolved_interval), "")
        if not price_id:
            raise ValueError(
                f"No Stripe price configured for plan={normalized_plan} interval={resolved_interval}"
            )
        return price_id

    if STRIPE_PRICE_ID:
        return STRIPE_PRICE_ID

    for key in STRIPE_DEFAULT_CHECKOUT_ORDER:
        price_id = STRIPE_PRICE_IDS.get(key, "")
        if price_id:
            return price_id

    raise RuntimeError("No Stripe price configured for checkout")


def infer_subscription_plan_from_checkout_payload(payload: dict | None) -> str | None:
    if not payload:
        return None
    return normalize_billing_plan(payload.get("plan"))


def infer_subscription_plan_from_stripe_object(data: dict | None) -> str | None:
    if not data:
        return None

    metadata = data.get("metadata") or {}
    plan_from_metadata = normalize_billing_plan(metadata.get("plan"))
    if plan_from_metadata:
        return plan_from_metadata

    items = (((data.get("items") or {}).get("data")) or []) if isinstance(data, dict) else []
    for item in items:
        price = item.get("price") or {}
        price_id = (price.get("id") or "").strip()
        for (plan, _interval), configured_price_id in STRIPE_PRICE_IDS.items():
            if configured_price_id and configured_price_id == price_id:
                return plan

    return None


def ensure_customer(user):
    if user["stripe_customer_id"]:
        return user["stripe_customer_id"]

    customer = stripe.Customer.create(email=user["email"], name=user["name"] or "")
    db = get_db()
    try:
        db.execute(
            "UPDATE users SET stripe_customer_id = %s WHERE id = %s",
            (customer.id, user["id"]),
        )
        db.commit()
    finally:
        db.close()

    return customer.id


def generate_reset_code() -> str:
    return str(secrets.randbelow(1_000_000)).zfill(6)


def send_reset_email(to_email: str, code: str) -> None:
    smtp_host = os.environ.get("SMTP_HOST", "")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER", "")
    smtp_pass = os.environ.get("SMTP_PASS", "")
    smtp_from = os.environ.get("SMTP_FROM", smtp_user)
    resend_api_key = os.environ.get("RESEND_API_KEY", smtp_pass)

    if not smtp_host and not resend_api_key:
        return

    subject = "Your Vocalype password reset code"
    body = (
        f"Your Vocalype password reset code is: {code}\n\n"
        "This code expires in 1 hour. If you did not request a password reset, "
        "you can safely ignore this email."
    )
    html = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f2ed;font-family:Inter,Arial,sans-serif;color:#171511;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f2ed;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #ded7cc;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:28px 32px 18px;border-bottom:1px solid #eee8df;">
              <div style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:#0a0a0a;">Vocal<span style="color:#c9a84c;">ype</span></div>
              <div style="margin-top:8px;font-size:13px;color:#756e66;">Account security</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px 30px;">
              <h1 style="margin:0 0 10px;font-size:24px;line-height:1.25;color:#171511;">Your password reset code</h1>
              <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#5e574f;">Use this code to choose a new Vocalype password. It expires in 1 hour.</p>
              <div style="margin:0 0 24px;padding:18px 20px;border-radius:10px;background:#0a0a0a;color:#ffffff;text-align:center;font-size:34px;line-height:1.1;font-weight:800;letter-spacing:0.18em;font-family:Consolas,Menlo,monospace;">{code}</div>
              <p style="margin:0;font-size:13px;line-height:1.6;color:#756e66;">If you did not request a password reset, you can safely ignore this email. Your current password will stay unchanged.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px;background:#faf8f4;border-top:1px solid #eee8df;font-size:12px;line-height:1.6;color:#8a8278;">
              This email was sent automatically by Vocalype. Never share this code with anyone else.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

    if resend_api_key:
        payload = json.dumps(
            {
                "from": smtp_from or "Vocalype <no-reply@vocalype.com>",
                "to": [to_email],
                "subject": subject,
                "text": body,
                "html": html,
            }
        ).encode("utf-8")
        req = urlrequest.Request(
            "https://api.resend.com/emails",
            data=payload,
            headers={
                "Authorization": f"Bearer {resend_api_key}",
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": "VocalypeBackend/1.0 (https://vocalype.com)",
            },
            method="POST",
        )
        try:
            with urlrequest.urlopen(req, timeout=10) as response:
                if response.status >= 300:
                    raise RuntimeError(f"Resend API failed with status {response.status}")
            return
        except urlerror.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Resend API failed with status {exc.code}: {details}") from exc

    if not smtp_host:
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = smtp_from
    msg["To"] = to_email
    msg.attach(MIMEText(body, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))

    with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
        server.ehlo()
        server.starttls()
        if smtp_user and smtp_pass:
            server.login(smtp_user, smtp_pass)
        server.sendmail(smtp_from, [to_email], msg.as_string())


def send_trial_start_email(to_email: str, name: str) -> None:
    smtp_host = os.environ.get("SMTP_HOST", "")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER", "")
    smtp_pass = os.environ.get("SMTP_PASS", "")
    smtp_from = os.environ.get("SMTP_FROM", smtp_user)

    if not smtp_host:
        return

    site_url = APP_RETURN_URL
    first_name = name.split()[0] if name else "là"

    plain = (
        f"Bonjour {first_name},\n\n"
        "Ton accès Premium Vocalype est actif. 14 jours complets, sans carte.\n\n"
        "Ce que tu as maintenant :\n"
        "  • Injection native dans toutes tes apps\n"
        "  • Raccourci clavier personnalisable\n"
        "  • Transcriptions illimitées\n"
        "  • Historique complet\n\n"
        "Aucune action requise — ton trial a démarré automatiquement.\n\n"
        f"Ouvre Vocalype et commence à dicter : {site_url}\n\n"
        "— L'équipe Vocalype"
    )

    html = f"""<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',system-ui,sans-serif;color:#e5e5e5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#181818;border-radius:12px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">

        <!-- Header -->
        <tr><td style="padding:32px 36px 24px;border-bottom:1px solid rgba(255,255,255,0.06);">
          <span style="display:inline-block;background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.25);color:#c9a84c;font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;padding:4px 12px;border-radius:100px;">Premium · 14 jours</span>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:28px 36px;">
          <p style="margin:0 0 8px;font-size:22px;font-weight:600;color:#fff;line-height:1.3;">
            Bonjour {first_name},
          </p>
          <p style="margin:0 0 24px;font-size:14px;color:rgba(255,255,255,0.5);line-height:1.6;">
            Ton accès Premium Vocalype est actif.<br>
            14 jours complets, sans carte de crédit.
          </p>

          <!-- Features -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            {"".join(
              f'<tr><td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">'
              f'<span style="color:#c9a84c;margin-right:10px;">✓</span>'
              f'<span style="font-size:13px;color:rgba(255,255,255,0.75);">{feat}</span></td></tr>'
              for feat in [
                "Injection native dans toutes tes apps",
                "Raccourci clavier personnalisable",
                "Transcriptions illimitées",
                "Historique complet",
              ]
            )}
          </table>

          <!-- CTA -->
          <a href="{site_url}" style="display:inline-block;background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.25);color:#c9a84c;font-size:13px;font-weight:600;padding:11px 24px;border-radius:8px;text-decoration:none;">
            Ouvrir Vocalype →
          </a>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:16px 36px;border-top:1px solid rgba(255,255,255,0.06);">
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.2);line-height:1.6;">
            Aucune carte requise pendant le trial. Tu peux annuler à tout moment.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Ton accès Premium Vocalype est actif — 14 jours complets"
    msg["From"] = smtp_from
    msg["To"] = to_email
    msg.attach(MIMEText(plain, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))

    try:
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.ehlo()
            server.starttls()
            if smtp_user and smtp_pass:
                server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_from, [to_email], msg.as_string())
    except Exception:
        app.logger.warning("send_trial_start_email failed to=%s", to_email)


def send_trial_reminder_email(to_email: str, name: str, days_left: int) -> None:
    smtp_host = os.environ.get("SMTP_HOST", "")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER", "")
    smtp_pass = os.environ.get("SMTP_PASS", "")
    smtp_from = os.environ.get("SMTP_FROM", smtp_user)

    if not smtp_host:
        return

    site_url = APP_RETURN_URL
    first_name = name.split()[0] if name else "là"
    days_str = "demain" if days_left <= 1 else f"dans {days_left} jours"

    plain = (
        f"Bonjour {first_name},\n\n"
        f"Ton trial Premium Vocalype expire {days_str}.\n\n"
        "Ce que tu perdras sans abonnement :\n"
        "  • Injection native dans tes apps (retour au presse-papier)\n"
        "  • Raccourcis clavier personnalisés (désactivés)\n"
        "  • Transcriptions illimitées (limité à 30/semaine)\n"
        "  • Historique complet (limité à 5 entrées)\n\n"
        "Passe à Premium maintenant pour continuer sans interruption.\n\n"
        f"Voir les offres : {site_url}\n\n"
        "— L'équipe Vocalype"
    )

    html = f"""<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',system-ui,sans-serif;color:#e5e5e5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#181818;border-radius:12px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">

        <!-- Header -->
        <tr><td style="padding:32px 36px 24px;border-bottom:1px solid rgba(255,255,255,0.06);">
          <span style="display:inline-block;background:rgba(234,88,12,0.12);border:1px solid rgba(234,88,12,0.25);color:#fb923c;font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;padding:4px 12px;border-radius:100px;">⚠ Trial expire {days_str}</span>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:28px 36px;">
          <p style="margin:0 0 8px;font-size:22px;font-weight:600;color:#fff;line-height:1.3;">
            Bonjour {first_name},
          </p>
          <p style="margin:0 0 24px;font-size:14px;color:rgba(255,255,255,0.5);line-height:1.6;">
            Ton accès Premium expire {days_str}.<br>
            Voici ce que tu perdras si tu ne passes pas à Premium :
          </p>

          <!-- What you'll lose -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            {"".join(
              f'<tr><td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">'
              f'<span style="color:#fb923c;margin-right:10px;">✕</span>'
              f'<span style="font-size:13px;color:rgba(255,255,255,0.75);">{feat}</span></td></tr>'
              for feat in [
                "Injection native dans tes apps (retour au presse-papier)",
                "Raccourcis clavier personnalisés (désactivés)",
                "Transcriptions illimitées (limité à 30/semaine)",
                "Historique complet (limité à 5 entrées)",
              ]
            )}
          </table>

          <!-- CTA -->
          <a href="{site_url}" style="display:inline-block;background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.25);color:#c9a84c;font-size:13px;font-weight:600;padding:11px 24px;border-radius:8px;text-decoration:none;">
            Passer à Premium →
          </a>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:16px 36px;border-top:1px solid rgba(255,255,255,0.06);">
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.2);line-height:1.6;">
            Tu peux continuer à utiliser Vocalype en mode Basic après l'expiration.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Ton trial Vocalype expire {days_str} — passe à Premium"
    msg["From"] = smtp_from
    msg["To"] = to_email
    msg.attach(MIMEText(plain, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))

    try:
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.ehlo()
            server.starttls()
            if smtp_user and smtp_pass:
                server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_from, [to_email], msg.as_string())
    except Exception:
        app.logger.warning("send_trial_reminder_email failed to=%s", to_email)


def maybe_send_trial_reminder(user) -> bool:
    """
    Returns True (and triggers reminder) if the user is trialing and their trial
    ends in 2 days or fewer, and the reminder hasn't been sent yet.
    """
    if user.get("subscription_status") != "trialing":
        return False
    if user.get("trial_reminder_sent"):
        return False

    trial_end = parse_iso(user.get("trial_end"))
    if trial_end is None:
        return False

    now = utc_now()
    days_left = (trial_end - now).days  # floor division

    if days_left > 2:
        return False

    # Mark sent immediately to prevent duplicate sends under concurrent requests
    db = get_db()
    db.execute(
        "UPDATE users SET trial_reminder_sent = 1 WHERE id = %s",
        (user["id"],),
    )
    db.commit()

    days_left_clamped = max(0, days_left)
    import threading
    threading.Thread(
        target=send_trial_reminder_email,
        args=(user["email"], user.get("name") or "", days_left_clamped),
        daemon=True,
    ).start()

    return True


def increment_latest_reset_attempt(db: _PgConn, user_id: int) -> None:
    latest_row = db.execute(
        """
        SELECT id, attempt_count FROM password_reset_tokens
        WHERE user_id = %s AND used = 0
        ORDER BY id DESC LIMIT 1
        """,
        (user_id,),
    ).fetchone()
    if not latest_row:
        return

    next_attempt_count = int(latest_row["attempt_count"] or 0) + 1
    db.execute(
        "UPDATE password_reset_tokens SET attempt_count = %s, used = %s WHERE id = %s",
        (
            next_attempt_count,
            1 if next_attempt_count >= MAX_RESET_TOKEN_ATTEMPTS else 0,
            latest_row["id"],
        ),
    )
    db.commit()


def find_valid_reset_token_row(db: _PgConn, user_id: int, code: str):
    rows = db.execute(
        """
        SELECT * FROM password_reset_tokens
        WHERE user_id = %s AND used = 0
        ORDER BY id DESC
        """,
        (user_id,),
    ).fetchall()

    now = utc_now()
    for row in rows:
        expires_at = parse_iso(row["expires_at"])
        if not expires_at or now > expires_at:
            continue
        if int(row["attempt_count"] or 0) >= MAX_RESET_TOKEN_ATTEMPTS:
            continue
        if row["token"] and check_password_hash(row["token"], code):
            return row

    return None


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "vocalype-backend"})


@app.route("/auth/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}
    email_value, error = require_json_string(data, "email")
    if error:
        return error
    password, error = require_json_string(data, "password")
    if error:
        return error
    name, error = optional_json_string(data, "name")
    if error:
        return error
    device_id, error = optional_json_string(data, "device_id")
    if error:
        return error
    ref_code, error = optional_json_string(data, "ref")
    if error:
        return error
    email = normalize_email(email_value)
    ip_address = client_ip()

    response = rate_limit_response(
        f"register:ip:{ip_address}",
        limit=5,
        window_seconds=3600,
        message="Trop de tentatives d'inscription. Réessayez plus tard.",
    )
    if response:
        return response

    if not email_is_valid(email):
        return jsonify({"error": "Email invalide"}), 400

    if not device_id_is_valid(device_id):
        return jsonify({"error": "Identifiant appareil invalide"}), 400
    if device_id and not device_id_is_stable(device_id):
        return jsonify({"error": "Identifiant appareil non supporté"}), 400

    password_error = password_validation_error(password)
    if password_error:
        return jsonify({"error": password_error}), 400

    if load_user_by_email(email):
        log_security_event(
            "register_blocked_existing_email",
            email=email,
            ip=ip_address,
        )
        return jsonify({"error": "Cet email est déjà utilisé"}), 409

    try:
        trial_end = (utc_now() + timedelta(days=14)).isoformat()
        db = get_db()
        try:
            db.execute(
                """
                INSERT INTO users (
                    email,
                    name,
                    password_hash,
                    subscription_status,
                    trial_end
                ) VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    email,
                    name,
                    generate_password_hash(password),
                    "trialing",
                    trial_end,
                ),
            )
            db.commit()
            user = db.execute(
                "SELECT * FROM users WHERE email = %s",
                (email,),
            ).fetchone()

            if ref_code:
                referrer = db.execute(
                    "SELECT id FROM users WHERE referral_code = %s",
                    (ref_code,),
                ).fetchone()
                if referrer and referrer["id"] != user["id"]:
                    db.execute(
                        "INSERT INTO referrals (referrer_id, referee_id) VALUES (%s, %s)",
                        (referrer["id"], user["id"]),
                    )
                    db.commit()
        finally:
            db.close()

        register_device(device_id, user["id"])
        attach_user_to_pending_workspace_invites(user)

        token = make_token(user)
        refresh_token = make_refresh_token(user)
        log_security_event("register_success", user_id=user["id"], email=email, ip=ip_address)

        # Send trial welcome email in background — never blocks the registration response
        import threading
        threading.Thread(
            target=send_trial_start_email,
            args=(email, name or ""),
            daemon=True,
        ).start()

        return jsonify(build_user_response(user, token, refresh_token=refresh_token)), 201
    except Exception:
        app.logger.exception("register_failed email=%s ip=%s", email, ip_address)
        return jsonify({"error": "Erreur interne"}), 500


@app.route("/auth/login", methods=["POST"])
def login():
    route_started_at = time.perf_counter()
    data = request.get_json(silent=True) or {}
    email_value, error = require_json_string(data, "email")
    if error:
        return error
    password, error = require_json_string(data, "password")
    if error:
        return error
    device_id, error = optional_json_string(data, "device_id")
    if error:
        return error
    email = normalize_email(email_value)
    ip_address = client_ip()

    response = rate_limit_response(
        f"login:ip:{ip_address}",
        limit=20,
        window_seconds=600,
        message="Trop de tentatives de connexion. Réessayez plus tard.",
    )
    if response:
        return response

    response = rate_limit_response(
        f"login:email:{email}:{ip_address}",
        limit=8,
        window_seconds=600,
        message="Trop de tentatives de connexion. Réessayez plus tard.",
    )
    if response:
        return response

    response = rate_limit_response(
        f"login:email:{email}",
        limit=12,
        window_seconds=1800,
        message="Trop de tentatives de connexion. Réessayez plus tard.",
    )
    if response:
        return response

    db = get_db()
    try:
        with timed_block("auth.login", "load_user", email=email):
            user = load_user_by_email(email, db=db)
        with timed_block("auth.login", "check_password_hash", email=email):
            password_ok = bool(user) and check_password_hash(user["password_hash"], password)
        if not user or not password_ok:
            log_security_event("login_failed", email=email, ip=ip_address)
            return jsonify({"error": "Email ou mot de passe incorrect"}), 401

        if device_id and not device_id_is_valid(device_id):
            return jsonify({"error": "Identifiant appareil invalide"}), 400

        if device_id and device_id_is_stable(device_id):
            with timed_block("auth.login", "register_device", user_id=user["id"]):
                register_device(device_id, user["id"], db=db)
        elif device_id:
            log_security_event(
                "login_unstable_device_id_ignored",
                email=email,
                ip=ip_address,
            )

        with timed_block("auth.login", "attach_pending_workspace_invites", user_id=user["id"]):
            attach_user_to_pending_workspace_invites(user, db=db)
        with timed_block("auth.login", "load_workspace", user_id=user["id"]):
            workspace_row = load_workspace_row_for_user(user["id"], db=db)
            user["__workspace_row_loaded__"] = True
            user["__workspace_row__"] = workspace_row
        with timed_block("auth.login", "make_tokens", user_id=user["id"]):
            token = make_token(user)
            refresh_token = make_refresh_token(user)
        log_security_event("login_success", user_id=user["id"], email=email, ip=ip_address)
        with timed_block("auth.login", "build_user_response", user_id=user["id"]):
            workspace_payload = (
                serialize_workspace(workspace_row, db=db) if workspace_row is not None else None
            )
            response_payload = build_user_response(
                user,
                token,
                refresh_token=refresh_token,
                workspace_row=workspace_row,
                workspace_payload=workspace_payload,
            )
        if AUTH_TIMING_ENABLED:
            app.logger.warning(
                "perf scope=auth.login stage=total duration_ms=%s user_id=%s",
                round((time.perf_counter() - route_started_at) * 1000, 1),
                user["id"],
            )
        return jsonify(response_payload)
    finally:
        db.close()


@app.route("/auth/session", methods=["GET"])
@auth_required
def session(user):
    attach_user_to_pending_workspace_invites(user)
    token = make_token(user)
    refresh_token = make_refresh_token(user)
    show_reminder = maybe_send_trial_reminder(user)
    return jsonify(build_user_response(user, token, refresh_token=refresh_token, show_trial_reminder=show_reminder))


@app.route("/auth/profile", methods=["PATCH"])
@auth_required
def update_profile(user):
    data = request.get_json(silent=True) or {}
    name, error = require_json_string(data, "name")
    if error:
        return error

    name = name.strip()
    if len(name) < 2:
        return jsonify({"error": "Nom trop court"}), 400
    if len(name) > 80:
        return jsonify({"error": "Nom trop long"}), 400

    db = get_db()
    try:
        db.execute(
            "UPDATE users SET name = %s WHERE id = %s",
            (name, user["id"]),
        )
        db.execute(
            "UPDATE organization_members SET name = %s WHERE user_id = %s",
            (name, user["id"]),
        )
        db.commit()
    finally:
        db.close()

    refreshed_user = load_user_by_id(user["id"])
    if not refreshed_user:
        return jsonify({"error": "Utilisateur introuvable"}), 404

    attach_user_to_pending_workspace_invites(refreshed_user)
    token = make_token(refreshed_user)
    refresh_token = make_refresh_token(refreshed_user)
    return jsonify(build_user_response(refreshed_user, token, refresh_token=refresh_token))


@app.route("/auth/refresh", methods=["POST"])
def refresh_token_endpoint():
    data = request.get_json(silent=True) or {}
    token = data.get("refresh_token", "").strip()
    if not token:
        return jsonify({"error": "Refresh token requis"}), 400

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except Exception:
        return jsonify({"error": "Refresh token invalide ou expiré"}), 401

    if payload.get("type") != "refresh":
        return jsonify({"error": "Type de token invalide"}), 401

    user = load_user_by_id(payload.get("user_id"))
    if not user:
        return jsonify({"error": "Utilisateur introuvable"}), 401

    try:
        token_version = int(user["token_version"] or 0)
        claimed_version = int(payload.get("ver", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "Token invalide"}), 401

    if claimed_version != token_version:
        return jsonify({"error": "Token révoqué"}), 401

    attach_user_to_pending_workspace_invites(user)
    new_access = make_token(user)
    new_refresh = make_refresh_token(user)
    return jsonify(build_user_response(user, new_access, refresh_token=new_refresh))


@app.route("/auth/logout", methods=["POST"])
@auth_required
def logout(user):
    # Stateless tokens — client deletes them locally.
    # Optionally bump token_version to invalidate all tokens immediately.
    return jsonify({"ok": True})


def parse_license_request_data():
    data = request.get_json(silent=True) or {}
    device_id = str(data.get("device_id", "")).strip().lower()
    app_version = str(data.get("app_version", "")).strip() or None
    app_channel = str(data.get("app_channel", "")).strip() or None
    integrity = data.get("integrity")
    return data, device_id, app_version, app_channel, integrity


def validate_license_device(device_id: str):
    if not device_id:
        return jsonify({"error": "Identifiant appareil requis"}), 400
    if not device_id_is_valid(device_id):
        return jsonify({"error": "Identifiant appareil invalide"}), 400
    if not device_id_is_stable(device_id):
        return jsonify({"error": "Identifiant appareil non supporté"}), 400
    return None


def prepare_license_response(
    user,
    device_id: str,
    app_version: str | None,
    app_channel: str | None,
    integrity: dict | None,
    *,
    db: _PgConn | None = None,
    workspace_row=None,
):
    with timed_block("license.issue", "register_device", user_id=user["id"]):
        register_device(device_id, user["id"], db=db)
    with timed_block("license.issue", "sync_entitlement_state", user_id=user["id"]):
        entitlement = sync_device_entitlement_state(
            user,
            device_id,
            app_version=app_version,
            app_channel=app_channel,
            db=db,
            workspace_row=workspace_row,
        )
    with timed_block("license.issue", "evaluate_build_integrity", user_id=user["id"]):
        integrity_evaluation = evaluate_build_integrity(
            user=user,
            device_id=device_id,
            app_channel=app_channel,
            integrity=integrity,
        )
    if not entitlement_allows_access(entitlement) or integrity_evaluation["blocked"]:
        return None, entitlement, integrity_evaluation
    with timed_block("license.issue", "build_license_payloads", user_id=user["id"]):
        license_payload = build_license_payloads(
            user,
            entitlement,
            device_id=device_id,
            integrity_evaluation=integrity_evaluation,
        )
    return (license_payload, entitlement, integrity_evaluation)


@app.route("/license/issue", methods=["POST"])
@auth_required
def issue_license(user):
    route_started_at = time.perf_counter()
    _, device_id, app_version, app_channel, integrity = parse_license_request_data()
    validation = validate_license_device(device_id)
    if validation:
        return validation

    db = get_db()
    try:
        workspace_row = load_workspace_row_for_user(user["id"], db=db)
        user["__workspace_row_loaded__"] = True
        user["__workspace_row__"] = workspace_row
        license_payload, entitlement, integrity_evaluation = prepare_license_response(
            user,
            device_id,
            app_version,
            app_channel,
            integrity,
            db=db,
            workspace_row=workspace_row,
        )
        if not license_payload:
            status_payload = build_license_status_response(user, entitlement, device_id=device_id)
            status_payload["refresh_after_seconds"] = LICENSE_REFRESH_INTERVAL_SECONDS
            status_payload["integrity_anomalies"] = integrity_evaluation["anomalies"]
            return jsonify({"error": "Accès premium inactif", "license": status_payload}), 403

        log_security_event(
            "license_issue_success",
            user_id=user["id"],
            device_id=device_id,
            status=entitlement["entitlement_status"] if entitlement else None,
        )
        if AUTH_TIMING_ENABLED:
            app.logger.warning(
                "perf scope=license.issue stage=total duration_ms=%s user_id=%s device_id=%s",
                round((time.perf_counter() - route_started_at) * 1000, 1),
                user["id"],
                device_id,
            )
        return jsonify({"license": license_payload})
    finally:
        db.close()


@app.route("/license/refresh", methods=["POST"])
@auth_required
def refresh_license(user):
    _, device_id, app_version, app_channel, integrity = parse_license_request_data()
    validation = validate_license_device(device_id)
    if validation:
        return validation

    license_payload, entitlement, integrity_evaluation = prepare_license_response(
        user, device_id, app_version, app_channel, integrity
    )
    if not license_payload:
        status_payload = build_license_status_response(user, entitlement, device_id=device_id)
        status_payload["refresh_after_seconds"] = LICENSE_REFRESH_INTERVAL_SECONDS
        status_payload["integrity_anomalies"] = integrity_evaluation["anomalies"]
        return jsonify({"error": "Accès premium expiré", "license": status_payload}), 403

    return jsonify({"license": license_payload})


@app.route("/license/heartbeat", methods=["POST"])
@auth_required
def license_heartbeat(user):
    _, device_id, app_version, app_channel, integrity = parse_license_request_data()
    validation = validate_license_device(device_id)
    if validation:
        return validation

    integrity_evaluation = evaluate_build_integrity(
        user=user,
        device_id=device_id,
        app_channel=app_channel,
        integrity=integrity,
    )
    entitlement = sync_device_entitlement_state(
        user,
        device_id,
        app_version=app_version,
        app_channel=app_channel,
    )
    status_payload = build_license_status_response(user, entitlement, device_id=device_id)
    status_payload["refresh_after_seconds"] = LICENSE_REFRESH_INTERVAL_SECONDS
    status_payload["integrity_anomalies"] = integrity_evaluation["anomalies"]
    return jsonify({"license": status_payload})


@app.route("/license/status", methods=["GET"])
@auth_required
def license_status(user):
    device_id = request.args.get("device_id", "").strip().lower()
    validation = validate_license_device(device_id)
    if validation:
        return validation

    entitlement = sync_device_entitlement_state(user, device_id)
    status_payload = build_license_status_response(user, entitlement, device_id=device_id)
    status_payload["refresh_after_seconds"] = LICENSE_REFRESH_INTERVAL_SECONDS
    return jsonify({"license": status_payload})


@app.route("/license/report-anomaly", methods=["POST"])
@auth_required
def report_license_anomaly(user):
    data = request.get_json(silent=True) or {}
    device_id = str(data.get("device_id", "")).strip().lower() or None
    anomaly_type = str(data.get("anomaly_type", "")).strip() or "unknown"
    details = data.get("details")

    record_license_integrity_event(
        event_type=anomaly_type,
        user_id=user["id"],
        device_id=device_id,
        details=details if isinstance(details, dict) else {"details": details},
    )
    log_security_event(
        "license_anomaly_reported",
        user_id=user["id"],
        device_id=device_id,
        anomaly_type=anomaly_type,
    )
    return jsonify({"ok": True})


@app.route("/transcription/quota", methods=["GET"])
@auth_required
def transcription_quota(user):
    """Returns the current week's transcription quota for basic-tier users."""
    tier = get_user_tier(user)
    quota = get_weekly_quota(user)
    return jsonify({"tier": tier, "quota": quota})


@app.route("/transcription/record", methods=["POST"])
@auth_required
def transcription_record(user):
    """Records a completed transcription and enforces the weekly quota for basic users.
    Returns 200 with remaining quota, or 429 when the limit is reached.
    Premium users always get 200 with no quota info.
    """
    tier = get_user_tier(user)
    if tier == "premium":
        return jsonify({"tier": "premium", "ok": True})

    now = utc_now()
    reset_at = parse_iso(user.get("weekly_transcription_reset_at"))
    count = int(user.get("weekly_transcription_count") or 0)

    # Reset counter if the week window has passed
    if reset_at is None or now >= reset_at:
        count = 0
        reset_at = now + timedelta(days=7)

    if count >= BASIC_WEEKLY_TRANSCRIPTION_LIMIT:
        quota = {
            "count": count,
            "limit": BASIC_WEEKLY_TRANSCRIPTION_LIMIT,
            "remaining": 0,
            "reset_at": dt_to_iso(reset_at),
        }
        return jsonify({"error": "Quota hebdomadaire atteint", "tier": "basic", "quota": quota}), 429

    count += 1
    db = get_db()
    try:
        db.execute(
            """
            UPDATE users
            SET weekly_transcription_count = %s,
                weekly_transcription_reset_at = %s
            WHERE id = %s
            """,
            (count, dt_to_iso(reset_at), user["id"]),
        )
        db.commit()
    finally:
        db.close()

    quota = {
        "count": count,
        "limit": BASIC_WEEKLY_TRANSCRIPTION_LIMIT,
        "remaining": BASIC_WEEKLY_TRANSCRIPTION_LIMIT - count,
        "reset_at": dt_to_iso(reset_at),
    }
    return jsonify({"tier": "basic", "ok": True, "quota": quota})


@app.route("/billing/checkout", methods=["POST"])
@auth_required
def billing_checkout(user):
    try:
        require_billing_configured()
        if has_premium_access(user):
            return jsonify({"error": "Abonnement premium déjà actif"}), 400

        payload = request.get_json(silent=True) or {}
        requested_plan = infer_subscription_plan_from_checkout_payload(payload)
        price_id = resolve_checkout_price_id(
            payload.get("plan"),
            payload.get("interval"),
        )
        customer_id = ensure_customer(user)
        checkout = stripe.checkout.Session.create(
            customer=customer_id,
            payment_method_types=["card"],
            line_items=[{"price": price_id, "quantity": 1}],
            mode="subscription",
            metadata={
                "user_id": str(user["id"]),
                "plan": requested_plan or "",
                "interval": (payload.get("interval") or "monthly"),
            },
            subscription_data={
                "metadata": {
                    "user_id": str(user["id"]),
                    "plan": requested_plan or "",
                    "interval": (payload.get("interval") or "monthly"),
                }
            },
            success_url=append_query_param(APP_RETURN_URL, "checkout=success"),
            cancel_url=append_query_param(APP_RETURN_URL, "checkout=cancelled"),
        )
        return jsonify({"url": checkout.url})
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except Exception:
        app.logger.exception("billing_checkout_failed user_id=%s", user["id"])
        return jsonify({"error": "Erreur interne"}), 500


@app.route("/billing/portal", methods=["POST"])
@auth_required
def billing_portal(user):
    if not user["stripe_customer_id"]:
        return jsonify({"error": "Aucun client Stripe trouvé"}), 400

    try:
        require_billing_configured()
        portal = stripe.billing_portal.Session.create(
            customer=user["stripe_customer_id"],
            return_url=APP_RETURN_URL,
        )
        return jsonify({"url": portal.url})
    except Exception:
        app.logger.exception("billing_portal_failed user_id=%s", user["id"])
        return jsonify({"error": "Erreur interne"}), 500


@app.route("/webhook", methods=["POST"])
def webhook():
    require_billing_configured()
    payload = request.data
    signature = request.headers.get("Stripe-Signature", "")

    try:
        event = stripe.Webhook.construct_event(
            payload,
            signature,
            STRIPE_WEBHOOK_SECRET,
        )
    except Exception:
        app.logger.exception("webhook_verification_failed")
        return jsonify({"error": "Signature webhook invalide"}), 400

    def update_subscription(
        customer_id: str,
        status: str,
        subscription_plan: str | None = None,
        trial_end: int | None = None,
        period_end: int | None = None,
    ):
        db = get_db()
        try:
            db.execute(
                """
                UPDATE users
                SET subscription_status = %s,
                    subscription_plan = COALESCE(%s, subscription_plan),
                    trial_end = %s,
                    period_end = %s
                WHERE stripe_customer_id = %s
                """,
                (
                    status,
                    subscription_plan,
                    to_iso(trial_end),
                    to_iso(period_end),
                    customer_id,
                ),
            )
            db.commit()
            row = db.execute(
                "SELECT id FROM users WHERE stripe_customer_id = %s",
                (customer_id,),
            ).fetchone()

            if row and status == "active":
                db.execute(
                    """
                    UPDATE referrals SET converted = 1
                    WHERE referee_id = %s AND converted = 0
                    """,
                    (row["id"],),
                )
                db.commit()
        finally:
            db.close()

        if row:
            sync_all_entitlements_for_user(row["id"])

    event_type = event["type"]
    data = event["data"]["object"]

    if event_type in (
        "customer.subscription.created",
        "customer.subscription.updated",
    ):
        resolved_plan = infer_subscription_plan_from_stripe_object(data)
        update_subscription(
            data["customer"],
            data["status"],
            resolved_plan,
            data.get("trial_end"),
            data.get("current_period_end"),
        )
    elif event_type == "customer.subscription.deleted":
        update_subscription(
            data["customer"],
            "canceled",
            infer_subscription_plan_from_stripe_object(data),
            data.get("trial_end"),
            data.get("current_period_end"),
        )

    return jsonify({"ok": True})


@app.route("/workspace/team", methods=["GET"])
@auth_required
def workspace_team(user):
    workspace, error = require_small_agency_workspace(user)
    if error:
        return error
    return jsonify({"workspace": serialize_workspace(workspace)})


@app.route("/workspace/team/invite", methods=["POST"])
@auth_required
def workspace_invite_member(user):
    workspace, error = require_small_agency_workspace(user)
    if error:
        return error
    if workspace["current_user_role"] not in {"owner", "admin"}:
        return jsonify({"error": "Droits admin requis"}), 403

    data = request.get_json(silent=True) or {}
    email_value, error = require_json_string(data, "email")
    if error:
        return error
    name, error = optional_json_string(data, "name")
    if error:
        return error
    role = str(data.get("role", "member")).strip().lower() or "member"
    if role not in {"admin", "member"}:
        return jsonify({"error": "Role invalide"}), 400

    email = normalize_email(email_value)
    if not email_is_valid(email):
        return jsonify({"error": "Email invalide"}), 400

    if len(list_workspace_members(workspace["id"])) >= int(workspace["seats_included"] or 0):
        return jsonify({"error": "Plus de siege disponible"}), 409

    db = get_db()
    try:
        existing = db.execute(
            """
            SELECT id FROM organization_members
            WHERE organization_id = %s AND email = %s
            """,
            (workspace["id"], email),
        ).fetchone()
        if existing:
            return jsonify({"error": "Membre deja present ou invite"}), 409

        linked_user = db.execute(
            "SELECT id, name FROM users WHERE email = %s",
            (email,),
        ).fetchone()
        accepted_at = dt_to_iso(utc_now()) if linked_user else None
        status = "active" if linked_user else "invited"
        db.execute(
            """
            INSERT INTO organization_members (
                organization_id,
                user_id,
                email,
                name,
                role,
                status,
                invited_by_user_id,
                accepted_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                workspace["id"],
                linked_user["id"] if linked_user else None,
                email,
                name or (linked_user["name"] if linked_user else email.split("@")[0]),
                role,
                status,
                user["id"],
                accepted_at,
            ),
        )
        db.commit()
    finally:
        db.close()

    refreshed_workspace = ensure_small_agency_workspace(user)
    return jsonify({"workspace": serialize_workspace(refreshed_workspace)})


@app.route("/workspace/team/member/remove", methods=["POST"])
@auth_required
def workspace_remove_member(user):
    workspace, error = require_small_agency_workspace(user)
    if error:
        return error
    if workspace["current_user_role"] not in {"owner", "admin"}:
        return jsonify({"error": "Droits admin requis"}), 403

    data = request.get_json(silent=True) or {}
    member_id, error = require_json_int(data, "member_id")
    if error:
        return error

    db = get_db()
    try:
        row = db.execute(
            """
            SELECT * FROM organization_members
            WHERE id = %s AND organization_id = %s
            """,
            (member_id, workspace["id"]),
        ).fetchone()
        if not row:
            return jsonify({"error": "Membre introuvable"}), 404
        if row["role"] == "owner":
            return jsonify({"error": "Impossible de retirer le owner"}), 400

        db.execute(
            "DELETE FROM organization_members WHERE id = %s",
            (member_id,),
        )
        db.commit()
    finally:
        db.close()

    refreshed_workspace = ensure_small_agency_workspace(user)
    return jsonify({"workspace": serialize_workspace(refreshed_workspace)})


@app.route("/workspace/shared-assets", methods=["GET"])
@auth_required
def workspace_shared_assets(user):
    workspace, error = require_small_agency_workspace(user)
    if error:
        return error
    serialized = serialize_workspace(workspace)
    return jsonify(
        {
            "templates": serialized["shared_templates"],
            "snippets": serialized["shared_snippets"],
            "dictionary": serialized["shared_dictionary"],
        }
    )


@app.route("/workspace/shared-assets/template", methods=["POST"])
@auth_required
def workspace_add_template(user):
    workspace, error = require_small_agency_workspace(user)
    if error:
        return error
    if workspace["current_user_role"] not in {"owner", "admin"}:
        return jsonify({"error": "Droits admin requis"}), 403

    data = request.get_json(silent=True) or {}
    name, error = require_json_string(data, "name")
    if error:
        return error
    description, error = optional_json_string(data, "description")
    if error:
        return error
    prompt, error = require_json_string(data, "prompt")
    if error:
        return error

    db = get_db()
    try:
        db.execute(
            """
            INSERT INTO organization_templates (
                organization_id,
                name,
                description,
                prompt,
                created_by_user_id
            )
            VALUES (%s, %s, %s, %s, %s)
            """,
            (workspace["id"], name, description, prompt, user["id"]),
        )
        db.commit()
    finally:
        db.close()

    refreshed_workspace = ensure_small_agency_workspace(user)
    return jsonify({"templates": serialize_workspace(refreshed_workspace)["shared_templates"]})


@app.route("/workspace/shared-assets/template/<asset_id>", methods=["PATCH", "DELETE"])
@auth_required
def workspace_manage_template(user, asset_id):
    workspace, error = require_small_agency_workspace(user)
    if error:
        return error
    if workspace["current_user_role"] not in {"owner", "admin"}:
        return jsonify({"error": "Droits admin requis"}), 403

    db = get_db()
    try:
        existing = db.execute(
            """
            SELECT id FROM organization_templates
            WHERE id = %s AND organization_id = %s
            """,
            (asset_id, workspace["id"]),
        ).fetchone()
        if not existing:
            return jsonify({"error": "Template introuvable"}), 404

        if request.method == "DELETE":
            db.execute("DELETE FROM organization_templates WHERE id = %s", (asset_id,))
        else:
            data = request.get_json(silent=True) or {}
            name, error = require_json_string(data, "name")
            if error:
                return error
            description, error = optional_json_string(data, "description")
            if error:
                return error
            prompt, error = require_json_string(data, "prompt")
            if error:
                return error

            db.execute(
                """
                UPDATE organization_templates
                SET name = %s, description = %s, prompt = %s
                WHERE id = %s
                """,
                (name, description, prompt, asset_id),
            )
        db.commit()
    finally:
        db.close()

    refreshed_workspace = ensure_small_agency_workspace(user)
    return jsonify({"templates": serialize_workspace(refreshed_workspace)["shared_templates"]})


@app.route("/workspace/shared-assets/snippet", methods=["POST"])
@auth_required
def workspace_add_snippet(user):
    workspace, error = require_small_agency_workspace(user)
    if error:
        return error
    if workspace["current_user_role"] not in {"owner", "admin"}:
        return jsonify({"error": "Droits admin requis"}), 403

    data = request.get_json(silent=True) or {}
    trigger, error = require_json_string(data, "trigger")
    if error:
        return error
    expansion, error = require_json_string(data, "expansion")
    if error:
        return error

    db = get_db()
    try:
        db.execute(
            """
            INSERT INTO organization_snippets (
                organization_id,
                trigger,
                expansion,
                created_by_user_id
            )
            VALUES (%s, %s, %s, %s)
            """,
            (workspace["id"], trigger, expansion, user["id"]),
        )
        db.commit()
    finally:
        db.close()

    refreshed_workspace = ensure_small_agency_workspace(user)
    return jsonify({"snippets": serialize_workspace(refreshed_workspace)["shared_snippets"]})


@app.route("/workspace/shared-assets/snippet/<asset_id>", methods=["PATCH", "DELETE"])
@auth_required
def workspace_manage_snippet(user, asset_id):
    workspace, error = require_small_agency_workspace(user)
    if error:
        return error
    if workspace["current_user_role"] not in {"owner", "admin"}:
        return jsonify({"error": "Droits admin requis"}), 403

    db = get_db()
    try:
        existing = db.execute(
            """
            SELECT id FROM organization_snippets
            WHERE id = %s AND organization_id = %s
            """,
            (asset_id, workspace["id"]),
        ).fetchone()
        if not existing:
            return jsonify({"error": "Snippet introuvable"}), 404

        if request.method == "DELETE":
            db.execute("DELETE FROM organization_snippets WHERE id = %s", (asset_id,))
        else:
            data = request.get_json(silent=True) or {}
            trigger, error = require_json_string(data, "trigger")
            if error:
                return error
            expansion, error = require_json_string(data, "expansion")
            if error:
                return error

            db.execute(
                """
                UPDATE organization_snippets
                SET trigger = %s, expansion = %s
                WHERE id = %s
                """,
                (trigger, expansion, asset_id),
            )
        db.commit()
    finally:
        db.close()

    refreshed_workspace = ensure_small_agency_workspace(user)
    return jsonify({"snippets": serialize_workspace(refreshed_workspace)["shared_snippets"]})


@app.route("/workspace/shared-assets/dictionary", methods=["POST"])
@auth_required
def workspace_add_dictionary_term(user):
    workspace, error = require_small_agency_workspace(user)
    if error:
        return error
    if workspace["current_user_role"] not in {"owner", "admin"}:
        return jsonify({"error": "Droits admin requis"}), 403

    data = request.get_json(silent=True) or {}
    term, error = require_json_string(data, "term")
    if error:
        return error
    note, error = optional_json_string(data, "note")
    if error:
        return error

    db = get_db()
    try:
        db.execute(
            """
            INSERT INTO organization_dictionary_terms (
                organization_id,
                term,
                note,
                created_by_user_id
            )
            VALUES (%s, %s, %s, %s)
            """,
            (workspace["id"], term, note, user["id"]),
        )
        db.commit()
    finally:
        db.close()

    refreshed_workspace = ensure_small_agency_workspace(user)
    return jsonify({"dictionary": serialize_workspace(refreshed_workspace)["shared_dictionary"]})


@app.route("/workspace/shared-assets/dictionary/<asset_id>", methods=["PATCH", "DELETE"])
@auth_required
def workspace_manage_dictionary_term(user, asset_id):
    workspace, error = require_small_agency_workspace(user)
    if error:
        return error
    if workspace["current_user_role"] not in {"owner", "admin"}:
        return jsonify({"error": "Droits admin requis"}), 403

    db = get_db()
    try:
        existing = db.execute(
            """
            SELECT id FROM organization_dictionary_terms
            WHERE id = %s AND organization_id = %s
            """,
            (asset_id, workspace["id"]),
        ).fetchone()
        if not existing:
            return jsonify({"error": "Terme introuvable"}), 404

        if request.method == "DELETE":
            db.execute(
                "DELETE FROM organization_dictionary_terms WHERE id = %s",
                (asset_id,),
            )
        else:
            data = request.get_json(silent=True) or {}
            term, error = require_json_string(data, "term")
            if error:
                return error
            note, error = optional_json_string(data, "note")
            if error:
                return error

            db.execute(
                """
                UPDATE organization_dictionary_terms
                SET term = %s, note = %s
                WHERE id = %s
                """,
                (term, note, asset_id),
            )
        db.commit()
    finally:
        db.close()

    refreshed_workspace = ensure_small_agency_workspace(user)
    return jsonify({"dictionary": serialize_workspace(refreshed_workspace)["shared_dictionary"]})


@app.route("/admin/activate", methods=["POST"])
def admin_activate():
    data = request.get_json(silent=True) or {}
    email = normalize_email(data.get("email", ""))
    requested_plan = normalize_billing_plan(data.get("plan")) or "power_user"
    ip_address = client_ip()
    admin_subject = get_current_admin_subject("admin:activate")

    response = rate_limit_response(
        f"admin_activate:ip:{ip_address}",
        limit=10,
        window_seconds=3600,
        message="Trop de tentatives administrateur. Réessayez plus tard.",
    )
    if response:
        return response

    if not admin_subject:
        log_security_event("admin_activate_denied", email=email, ip=ip_address)
        return jsonify({"error": "Non autorisé"}), 401

    if not email:
        return jsonify({"error": "Email requis"}), 400

    db = get_db()
    try:
        user = db.execute("SELECT * FROM users WHERE email = %s", (email,)).fetchone()
        if not user:
            return jsonify({"error": "Utilisateur introuvable"}), 404

        far_future = datetime(2099, 12, 31, tzinfo=timezone.utc).isoformat()
        db.execute(
            """
            UPDATE users
            SET subscription_status = %s, subscription_plan = %s, period_end = %s
            WHERE email = %s
            """,
            ("active", requested_plan, far_future, email),
        )
        db.commit()
    finally:
        db.close()

    sync_all_entitlements_for_user(user["id"])

    log_security_event(
        "admin_activate_success",
        email=email,
        ip=ip_address,
        admin_subject=admin_subject,
    )
    return jsonify(
        {
            "ok": True,
            "email": email,
            "status": "active",
            "plan": requested_plan,
            "admin_subject": admin_subject,
        }
    )


@app.route("/license/revoke-device", methods=["POST"])
def revoke_device():
    data = request.get_json(silent=True) or {}
    device_id = str(data.get("device_id", "")).strip().lower()
    user_id = data.get("user_id")
    admin_subject = get_current_admin_subject("admin:license")
    ip_address = client_ip()

    response = rate_limit_response(
        f"license_revoke:ip:{ip_address}",
        limit=20,
        window_seconds=3600,
        message="Trop de tentatives administrateur. Réessayez plus tard.",
    )
    if response:
        return response

    if not admin_subject:
        log_security_event("license_revoke_denied", ip=ip_address, device_id=device_id)
        return jsonify({"error": "Non autorisé"}), 401

    if not device_id or not device_id_is_valid(device_id):
        return jsonify({"error": "Identifiant appareil invalide"}), 400

    db = get_db()
    try:
        entitlement = None
        if user_id:
            entitlement = db.execute(
                """
                SELECT * FROM premium_device_entitlements
                WHERE user_id = %s AND device_id = %s
                """,
                (user_id, device_id),
            ).fetchone()
        else:
            entitlement = db.execute(
                """
                SELECT * FROM premium_device_entitlements
                WHERE device_id = %s
                ORDER BY id DESC
                LIMIT 1
                """,
                (device_id,),
            ).fetchone()

        if not entitlement:
            return jsonify({"error": "Entitlement appareil introuvable"}), 404

        now = utc_now()
        db.execute(
            """
            UPDATE premium_device_entitlements
            SET entitlement_status = %s,
                revoked_at = %s,
                grace_until = %s,
                last_seen_at = %s
            WHERE id = %s
            """,
            (
                ENTITLEMENT_STATUS_REVOKED,
                dt_to_iso(now),
                dt_to_iso(now),
                dt_to_iso(now),
                entitlement["id"],
            ),
        )
        db.commit()
    finally:
        db.close()

    log_security_event(
        "license_revoke_success",
        admin_subject=admin_subject,
        device_id=device_id,
        user_id=user_id or entitlement["user_id"],
        ip=ip_address,
    )
    return jsonify(
        {
            "ok": True,
            "device_id": device_id,
            "user_id": str(user_id or entitlement["user_id"]),
            "status": ENTITLEMENT_STATUS_REVOKED,
            "admin_subject": admin_subject,
        }
    )


@app.route("/auth/forgot-password", methods=["POST"])
def forgot_password():
    data = request.get_json(silent=True) or {}
    email = data.get("email", "").strip().lower()
    client_ip = get_client_ip()

    retry_after = enforce_rate_limits(
        *(
            (scope, client_ip if scope.endswith(":ip") else (email or "unknown"), max_attempts, window_seconds, block_seconds)
            for scope, max_attempts, window_seconds, block_seconds in FORGOT_PASSWORD_LIMITS
        ),
        increment=True,
    )
    if retry_after:
        return (
            jsonify(
                {
                    "error": "Trop de demandes de réinitialisation. Réessayez plus tard.",
                    "retry_after_seconds": retry_after,
                }
            ),
            429,
        )

    user = load_user_by_email(email)
    if user:
        code = generate_reset_code()
        expires_at = (utc_now() + timedelta(hours=1)).isoformat()
        db = get_db()
        try:
            db.execute(
                "UPDATE password_reset_tokens SET used = 1 WHERE user_id = %s AND used = 0",
                (user["id"],),
            )
            db.execute(
                """
                INSERT INTO password_reset_tokens (user_id, token, expires_at, used, attempt_count)
                VALUES (%s, %s, %s, 0, 0)
                """,
                (user["id"], generate_password_hash(code), expires_at),
            )
            db.commit()
        finally:
            db.close()

        try:
            send_reset_email(email, code)
        except Exception:
            app.logger.exception("send_reset_email failed to=%s", email)

    log_security_event(
        "forgot_password_requested",
        email=email,
        ip=client_ip,
        user_found=bool(user),
    )
    return jsonify({"ok": True})


@app.route("/auth/verify-reset-code", methods=["POST"])
def verify_reset_code():
    data = request.get_json(silent=True) or {}
    email = normalize_email(data.get("email", ""))
    code = data.get("code", "").strip()
    client_ip = get_client_ip()

    retry_after = enforce_rate_limits(
        *(
            (scope, client_ip if scope.endswith(":ip") else (email or "unknown"), max_attempts, window_seconds, block_seconds)
            for scope, max_attempts, window_seconds, block_seconds in RESET_VERIFY_LIMITS
        ),
        increment=False,
    )
    if retry_after:
        return (
            jsonify(
                {
                    "error": "Trop de tentatives. Réessayez plus tard.",
                    "retry_after_seconds": retry_after,
                }
            ),
            429,
        )

    user = load_user_by_email(email)
    if not user:
        enforce_rate_limits(
            *(
                (scope, client_ip if scope.endswith(":ip") else (email or "unknown"), max_attempts, window_seconds, block_seconds)
                for scope, max_attempts, window_seconds, block_seconds in RESET_VERIFY_LIMITS
            ),
            increment=True,
        )
        return jsonify({"error": "Code invalide ou expiré"}), 400

    db = get_db()
    try:
        row = find_valid_reset_token_row(db, user["id"], code)
        if not row:
            enforce_rate_limits(
                *(
                    (scope, client_ip if scope.endswith(":ip") else (email or "unknown"), max_attempts, window_seconds, block_seconds)
                    for scope, max_attempts, window_seconds, block_seconds in RESET_VERIFY_LIMITS
                ),
                increment=True,
            )
            increment_latest_reset_attempt(db, user["id"])
            return jsonify({"error": "Code invalide ou expiré"}), 400
    finally:
        db.close()

    clear_rate_limit("verify_reset:ip", client_ip)
    clear_rate_limit("verify_reset:email", email)
    return jsonify({"valid": True})


@app.route("/auth/reset-password", methods=["POST"])
def reset_password():
    data = request.get_json(silent=True) or {}
    email = normalize_email(data.get("email", ""))
    code = data.get("code", "").strip()
    new_password = data.get("new_password", "")
    client_ip = get_client_ip()

    response = rate_limit_response(
        f"reset_password:ip:{client_ip}",
        limit=8,
        window_seconds=900,
        message="Trop de tentatives de réinitialisation. Réessayez plus tard.",
    )
    if response:
        return response

    response = rate_limit_response(
        f"reset_password:email:{email}",
        limit=5,
        window_seconds=900,
        message="Trop de tentatives de réinitialisation. Réessayez plus tard.",
    )
    if response:
        return response

    password_error = password_validation_error(new_password)
    if password_error:
        return jsonify({"error": password_error}), 400

    retry_after = enforce_rate_limits(
        *(
            (scope, client_ip if scope.endswith(":ip") else (email or "unknown"), max_attempts, window_seconds, block_seconds)
            for scope, max_attempts, window_seconds, block_seconds in RESET_PASSWORD_LIMITS
        ),
        increment=False,
    )
    if retry_after:
        return (
            jsonify(
                {
                    "error": "Trop de tentatives. Réessayez plus tard.",
                    "retry_after_seconds": retry_after,
                }
            ),
            429,
        )

    user = load_user_by_email(email)
    if not user:
        enforce_rate_limits(
            *(
                (scope, client_ip if scope.endswith(":ip") else (email or "unknown"), max_attempts, window_seconds, block_seconds)
                for scope, max_attempts, window_seconds, block_seconds in RESET_PASSWORD_LIMITS
            ),
            increment=True,
        )
        return jsonify({"error": "Code invalide ou expiré"}), 400

    db = get_db()
    try:
        row = find_valid_reset_token_row(db, user["id"], code)
        if not row:
            enforce_rate_limits(
                *(
                    (scope, client_ip if scope.endswith(":ip") else (email or "unknown"), max_attempts, window_seconds, block_seconds)
                    for scope, max_attempts, window_seconds, block_seconds in RESET_PASSWORD_LIMITS
                ),
                increment=True,
            )
            increment_latest_reset_attempt(db, user["id"])
            return jsonify({"error": "Code invalide ou expiré"}), 400

        db.execute(
            "UPDATE password_reset_tokens SET used = 1 WHERE user_id = %s",
            (user["id"],),
        )
        next_token_version = int(user["token_version"] or 0) + 1
        db.execute(
            "UPDATE users SET password_hash = %s, token_version = %s WHERE id = %s",
            (generate_password_hash(new_password), next_token_version, user["id"]),
        )
        db.commit()
        user = db.execute("SELECT * FROM users WHERE id = %s", (user["id"],)).fetchone()
    finally:
        db.close()

    clear_rate_limit("reset_password:ip", client_ip)
    clear_rate_limit("reset_password:email", email)
    clear_rate_limit("verify_reset:ip", client_ip)
    clear_rate_limit("verify_reset:email", email)
    clear_rate_limit("forgot_password:email", email)
    token = make_token(user)
    attach_user_to_pending_workspace_invites(user)
    return jsonify(build_user_response(user, token))


@app.route("/auth/change-password", methods=["POST"])
@auth_required
def change_password(user):
    data = request.get_json(silent=True) or {}
    old_password = data.get("old_password", "")
    new_password = data.get("new_password", "")
    ip_address = client_ip()

    if not check_password_hash(user["password_hash"], old_password):
        log_security_event("change_password_failed", user_id=user["id"], ip=ip_address)
        return jsonify({"error": "Mot de passe actuel incorrect"}), 400

    password_error = password_validation_error(new_password)
    if password_error:
        return jsonify({"error": password_error}), 400

    db = get_db()
    try:
        next_token_version = int(user["token_version"] or 0) + 1
        db.execute(
            "UPDATE users SET password_hash = %s, token_version = %s WHERE id = %s",
            (generate_password_hash(new_password), next_token_version, user["id"]),
        )
        db.commit()
    finally:
        db.close()

    log_security_event("change_password_success", user_id=user["id"], ip=ip_address)
    return jsonify({"ok": True})


REFERRAL_BASE_URL = os.environ.get("REFERRAL_BASE_URL", "https://vocalype.com/r")


def _get_or_create_referral_code(user, db: _PgConn) -> str:
    """Return the user's referral code, creating one if it doesn't exist yet."""
    code = user["referral_code"]
    if code:
        return code
    code = secrets.token_urlsafe(8)
    db.execute("UPDATE users SET referral_code = %s WHERE id = %s", (code, user["id"]))
    db.commit()
    return code


@app.route("/referral/code", methods=["GET"])
@auth_required
def get_referral_code(user):
    db = get_db()
    try:
        # Reload fresh row so referral_code is up to date
        row = db.execute("SELECT * FROM users WHERE id = %s", (user["id"],)).fetchone()
        if not row:
            return jsonify({"error": "User not found"}), 404
        code = _get_or_create_referral_code(row, db)
    finally:
        db.close()
    return jsonify({
        "code": code,
        "referral_url": f"{REFERRAL_BASE_URL}/{code}",
    })


@app.route("/referral/stats", methods=["GET"])
@auth_required
def get_referral_stats(user):
    db = get_db()
    try:
        row = db.execute(
            """
            SELECT
                COUNT(*)                                    AS referral_count,
                SUM(CASE WHEN converted = 1 THEN 1 ELSE 0 END) AS converted_count
            FROM referrals
            WHERE referrer_id = %s
            """,
            (user["id"],),
        ).fetchone()
    finally:
        db.close()
    referral_count = int(row["referral_count"] or 0)
    converted_count = int(row["converted_count"] or 0)
    return jsonify({
        "referral_count": referral_count,
        "converted_count": converted_count,
        "earned_months": converted_count,  # 1 free month per conversion
    })


@app.route("/llm/v1/chat/completions", methods=["POST"])
@auth_required
def cloud_llm_proxy(user):
    """Proxy post-processing LLM requests to Cerebras on behalf of authenticated users."""
    limit_resp = rate_limit_response(
        f"cloud_llm:{user['id']}",
        limit=CLOUD_LLM_RATE_LIMIT_PER_HOUR,
        window_seconds=3600,
        message="Too many LLM requests. Please wait before trying again.",
    )
    if limit_resp:
        return limit_resp

    if not GROQ_API_KEY:
        return jsonify({"error": "Cloud LLM not configured on this server"}), 503

    try:
        req_body = request.get_json(force=True) or {}
    except Exception:
        return jsonify({"error": "Invalid JSON body"}), 400

    messages = req_body.get("messages")
    if not messages or not isinstance(messages, list):
        return jsonify({"error": "messages field is required"}), 400

    requested_model = str(req_body.get("model") or "").strip()
    resolved_model = CLOUD_LLM_MODEL
    if requested_model:
        if requested_model not in CLOUD_LLM_ALLOWED_MODELS:
            return jsonify(
                {
                    "error": "Requested model is not allowed",
                    "requested_model": requested_model,
                    "allowed_models": CLOUD_LLM_ALLOWED_MODELS,
                }
            ), 400
        resolved_model = requested_model

    payload = {
        "model": resolved_model,
        "messages": messages,
        "max_tokens": min(int(req_body.get("max_tokens") or 300), 1000),
        "temperature": float(req_body.get("temperature") or 0.0),
        "stream": False,
    }

    reasoning_format = req_body.get("reasoning_format")
    if isinstance(reasoning_format, str) and reasoning_format.strip():
        payload["reasoning_format"] = reasoning_format.strip()

    include_reasoning = req_body.get("include_reasoning")
    if isinstance(include_reasoning, bool):
        payload["include_reasoning"] = include_reasoning

    try:
        import requests as req_lib
        groq_resp = req_lib.post(
            "https://api.groq.com/openai/v1/chat/completions",
            json=payload,
            headers={
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "VocalypeCloud/1.0 (server-side; +https://vocalype.com)",
            },
            timeout=30,
        )
        if groq_resp.status_code == 200:
            return jsonify(groq_resp.json()), 200
        else:
            error_body = groq_resp.text[:500]
            return jsonify({"error": f"LLM provider error: {groq_resp.status_code} {error_body}"}), 502
    except Exception as e:
        return jsonify({"error": f"LLM provider unreachable: {str(e)}"}), 502


@app.route("/llm/v1/models", methods=["GET"])
@auth_required
def cloud_llm_models(user):
    """Expose the allowlisted cloud LLM models to authenticated clients."""
    return jsonify(
        {
            "object": "list",
            "data": [
                {"id": model, "object": "model", "owned_by": "vocalype-cloud"}
                for model in CLOUD_LLM_ALLOWED_MODELS
            ],
            "default_model": CLOUD_LLM_MODEL,
        }
    )


if __name__ == "__main__":
    require_secret_configured()
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
