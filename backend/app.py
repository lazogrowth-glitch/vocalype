#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import secrets
import smtplib
import sqlite3
import re
import time
import uuid
import hashlib
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from functools import wraps
from threading import Lock
from typing import Optional

import jwt
import stripe
from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__)

DEFAULT_ALLOWED_ORIGINS = (
    "https://vocaltypeai.com",
    "https://www.vocaltypeai.com",
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
PASSWORD_MIN_LENGTH = env_int("MIN_PASSWORD_LENGTH", 12, 12)
RATE_LIMIT_BUCKETS: defaultdict[str, deque[float]] = defaultdict(deque)
RATE_LIMIT_LOCK = Lock()

CORS(
    app,
    resources={
        r"/*": {
            "origins": CORS_ALLOWED_ORIGINS,
            "methods": ["GET", "POST", "OPTIONS"],
            "allow_headers": ["Authorization", "Content-Type"],
            "max_age": 600,
        }
    },
)

STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_PRICE_ID = os.environ.get("STRIPE_PRICE_ID", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
JWT_SECRET = os.environ.get("JWT_SECRET", "")
ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "")
ADMIN_TOKEN_SECRET = os.environ.get("ADMIN_TOKEN_SECRET", "")
ADMIN_TOKEN_AUDIENCE = os.environ.get("ADMIN_TOKEN_AUDIENCE", "vocaltype-admin")
ADMIN_TOKEN_MAX_AGE_SECONDS = env_int("ADMIN_TOKEN_MAX_AGE_SECONDS", 300, 60)
LICENSE_GRANT_TTL_SECONDS = env_int("LICENSE_GRANT_TTL_SECONDS", 3600, 300)
LICENSE_OFFLINE_TTL_SECONDS = env_int("LICENSE_OFFLINE_TTL_SECONDS", 72 * 3600, 3600)
LICENSE_REFRESH_INTERVAL_SECONDS = env_int("LICENSE_REFRESH_INTERVAL_SECONDS", 20 * 60, 300)
LICENSE_REVOCATION_GRACE_SECONDS = env_int(
    "LICENSE_REVOCATION_GRACE_SECONDS", 24 * 3600, 3600
)
LICENSE_AUDIENCE = os.environ.get("LICENSE_AUDIENCE", "vocaltype-license")
LICENSE_ISSUER = os.environ.get("LICENSE_ISSUER", "vocaltype-backend")
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
    os.environ.get("FRONTEND_URL", "https://vocaltypeai.com"),
)
DATABASE_PATH = os.environ.get("DATABASE_PATH", "vocaltype.db")
TRUST_X_FORWARDED_FOR = os.environ.get("TRUST_X_FORWARDED_FOR", "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}

stripe.api_key = STRIPE_SECRET_KEY
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024

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


def log_security_event(event: str, **fields) -> None:
    rendered_fields = " ".join(
        f"{key}={value}" for key, value in fields.items() if value not in (None, "")
    )
    if rendered_fields:
        app.logger.warning("security_event=%s %s", event, rendered_fields)
    else:
        app.logger.warning("security_event=%s", event)


def normalize_email(value: str) -> str:
    return value.strip().lower()


def email_is_valid(email: str) -> bool:
    return bool(EMAIL_REGEX.fullmatch(email))


def password_validation_error(password: str) -> str | None:
    if len(password) < PASSWORD_MIN_LENGTH:
        return (
            f"Mot de passe trop court (minimum {PASSWORD_MIN_LENGTH} caractères)"
        )

    classes = sum(
        (
            bool(re.search(r"[a-z]", password)),
            bool(re.search(r"[A-Z]", password)),
            bool(re.search(r"[0-9]", password)),
            bool(re.search(r"[^A-Za-z0-9]", password)),
        )
    )
    if classes < 3:
        return (
            "Mot de passe trop faible "
            "(utilisez au moins trois types de caractères : minuscules, "
            "majuscules, chiffres, symboles)"
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


def get_db():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def column_exists(db: sqlite3.Connection, table_name: str, column_name: str) -> bool:
    rows = db.execute(f"PRAGMA table_info({table_name})").fetchall()
    return any(row["name"] == column_name for row in rows)


def ensure_column(
    db: sqlite3.Connection,
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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS premium_device_entitlements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    db.commit()
    db.close()


init_db()


def make_token(user) -> str:
    payload = {
        "user_id": user["id"],
        "ver": int(user["token_version"] or 0),
        "exp": utc_now() + timedelta(minutes=ACCESS_TOKEN_TTL_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def load_user_by_id(user_id: int):
    db = get_db()
    try:
        return db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    finally:
        db.close()


def load_user_by_email(email: str):
    db = get_db()
    try:
        return db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    finally:
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
            VALUES (?, ?, ?, ?)
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
            WHERE user_id = ? AND device_id = ?
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
            INSERT OR IGNORE INTO premium_device_entitlements (
                user_id,
                device_id,
                plan,
                entitlement_status,
                created_at,
                last_seen_at,
                last_grant_issued_at,
                app_version,
                app_channel
            ) VALUES (?, ?, 'premium', ?, ?, ?, ?, ?, ?)
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
                entitlement_status = ?,
                last_seen_at = ?,
                last_grant_issued_at = ?,
                revoked_at = NULL,
                grace_until = NULL,
                app_version = COALESCE(?, app_version),
                app_channel = COALESCE(?, app_channel)
            WHERE user_id = ? AND device_id = ?
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
            WHERE user_id = ? AND device_id = ?
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
):
    if not device_id:
        return None

    db = get_db()
    try:
        now = utc_now()
        now_iso = dt_to_iso(now)
        row = db.execute(
            """
            SELECT * FROM premium_device_entitlements
            WHERE user_id = ? AND device_id = ?
            """,
            (user["id"], device_id),
        ).fetchone()

        tier = get_user_tier(user)
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
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                SET plan = ?,
                    entitlement_status = ?,
                    last_seen_at = ?,
                    last_grant_issued_at = ?,
                    revoked_at = NULL,
                    grace_until = NULL,
                    app_version = COALESCE(?, app_version),
                    app_channel = COALESCE(?, app_channel)
                WHERE id = ?
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
            WHERE user_id = ? AND device_id = ?
            """,
            (user["id"], device_id),
        ).fetchone()
    finally:
        db.close()


def sync_all_entitlements_for_user(user_id: int) -> None:
    user = load_user_by_id(user_id)
    if not user:
        return

    db = get_db()
    try:
        device_rows = db.execute(
            "SELECT device_id FROM premium_device_entitlements WHERE user_id = ?",
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
    tamper_flags = integrity.get("tamper_flags") or []

    if app_channel and LICENSE_ALLOWED_CHANNELS and app_channel not in LICENSE_ALLOWED_CHANNELS:
        anomalies.append(f"channel_not_allowed:{app_channel}")

    if not release_build and not LICENSE_ALLOW_DEBUG_BUILDS:
        anomalies.append("debug_build_disallowed")

    for item in tamper_flags:
        value = str(item).strip()
        if value:
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
                "vocaltype-model-unlock-v1",
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

    return {
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
            "SELECT id FROM device_registrations WHERE device_id = ?",
            (device_id,),
        ).fetchone()
        return row is not None
    finally:
        db.close()


def register_device(device_id: str, user_id: int) -> None:
    if not device_id:
        return
    db = get_db()
    try:
        db.execute(
            "INSERT OR IGNORE INTO device_registrations (device_id, user_id) VALUES (?, ?)",
            (device_id, user_id),
        )
        db.commit()
    finally:
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
            "SELECT * FROM auth_rate_limits WHERE key = ?",
            (key,),
        ).fetchone()

        if not row:
            if increment:
                db.execute(
                    """
                    INSERT INTO auth_rate_limits (key, attempts, window_started_at, blocked_until)
                    VALUES (?, ?, ?, NULL)
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
                SET attempts = ?, window_started_at = ?, blocked_until = ?
                WHERE key = ?
                """,
                (attempts, window_started_at.isoformat(), blocked_until.isoformat(), key),
            )
            db.commit()
            return block_seconds

        db.execute(
            """
            UPDATE auth_rate_limits
            SET attempts = ?, window_started_at = ?, blocked_until = NULL
            WHERE key = ?
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
        db.execute("DELETE FROM auth_rate_limits WHERE key = ?", (key,))
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


def get_user_tier(user) -> str:
    """Returns 'premium' or 'basic'. Never returns a hard-blocked state."""
    status = user["subscription_status"]
    if status == "active":
        return "premium"
    if status == "trialing":
        trial_end = parse_iso(user["trial_end"])
        if trial_end and utc_now() < trial_end:
            return "premium"
    return "basic"


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


def build_user_response(user, token: str, *, show_trial_reminder: bool = False):
    tier = get_user_tier(user)
    response = {
        "token": token,
        "user": {
            "id": str(user["id"]),
            "email": user["email"],
            "name": user["name"] or user["email"].split("@")[0],
        },
        "subscription": {
            "status": user["subscription_status"],
            "trial_ends_at": user["trial_end"],
            "current_period_ends_at": user["period_end"],
            "has_access": True,
            "tier": tier,
        },
    }
    if tier == "basic":
        response["subscription"]["quota"] = get_weekly_quota(user)
    if show_trial_reminder:
        response["show_trial_reminder"] = True
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
    if not STRIPE_PRICE_ID:
        raise RuntimeError("STRIPE_PRICE_ID is required")
    if not STRIPE_WEBHOOK_SECRET:
        raise RuntimeError("STRIPE_WEBHOOK_SECRET is required")


def ensure_customer(user):
    if user["stripe_customer_id"]:
        return user["stripe_customer_id"]

    customer = stripe.Customer.create(email=user["email"], name=user["name"] or "")
    db = get_db()
    try:
        db.execute(
            "UPDATE users SET stripe_customer_id = ? WHERE id = ?",
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

    if not smtp_host:
        return

    body = (
        f"Your VocalType password reset code is: {code}\n\n"
        "This code expires in 1 hour. If you did not request a reset, "
        "you can safely ignore this email."
    )
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = "VocalType - Password Reset Code"
    msg["From"] = smtp_from
    msg["To"] = to_email

    with smtplib.SMTP(smtp_host, smtp_port) as server:
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
        "Ton accès Premium VocalType est actif. 14 jours complets, sans carte.\n\n"
        "Ce que tu as maintenant :\n"
        "  • Injection native dans toutes tes apps\n"
        "  • Raccourci clavier personnalisable\n"
        "  • Transcriptions illimitées\n"
        "  • Historique complet\n\n"
        "Aucune action requise — ton trial a démarré automatiquement.\n\n"
        f"Ouvre VocalType et commence à dicter : {site_url}\n\n"
        "— L'équipe VocalType"
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
            Ton accès Premium VocalType est actif.<br>
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
            Ouvrir VocalType →
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
    msg["Subject"] = "Ton accès Premium VocalType est actif — 14 jours complets"
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
        f"Ton trial Premium VocalType expire {days_str}.\n\n"
        "Ce que tu perdras sans abonnement :\n"
        "  • Injection native dans tes apps (retour au presse-papier)\n"
        "  • Raccourcis clavier personnalisés (désactivés)\n"
        "  • Transcriptions illimitées (limité à 30/semaine)\n"
        "  • Historique complet (limité à 5 entrées)\n\n"
        "Passe à Premium maintenant pour continuer sans interruption.\n\n"
        f"Voir les offres : {site_url}\n\n"
        "— L'équipe VocalType"
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
            Tu peux continuer à utiliser VocalType en mode Basic après l'expiration.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Ton trial VocalType expire {days_str} — passe à Premium"
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
        "UPDATE users SET trial_reminder_sent = 1 WHERE id = ?",
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


def increment_latest_reset_attempt(db: sqlite3.Connection, user_id: int) -> None:
    latest_row = db.execute(
        """
        SELECT id, attempt_count FROM password_reset_tokens
        WHERE user_id = ? AND used = 0
        ORDER BY id DESC LIMIT 1
        """,
        (user_id,),
    ).fetchone()
    if not latest_row:
        return

    next_attempt_count = int(latest_row["attempt_count"] or 0) + 1
    db.execute(
        "UPDATE password_reset_tokens SET attempt_count = ?, used = ? WHERE id = ?",
        (
            next_attempt_count,
            1 if next_attempt_count >= MAX_RESET_TOKEN_ATTEMPTS else 0,
            latest_row["id"],
        ),
    )
    db.commit()


def find_valid_reset_token_row(db: sqlite3.Connection, user_id: int, code: str):
    rows = db.execute(
        """
        SELECT * FROM password_reset_tokens
        WHERE user_id = ? AND used = 0
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
    return jsonify({"status": "ok", "service": "vocaltype-backend"})


@app.route("/auth/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}
    email = normalize_email(data.get("email", ""))
    password = data.get("password", "")
    name = data.get("name", "").strip() or None
    device_id = data.get("device_id", "").strip() or None
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

    if device_id and device_is_registered(device_id):
        log_security_event(
            "register_blocked_existing_device",
            email=email,
            ip=ip_address,
            device_id=device_id,
        )
        return jsonify({"error": "Un compte existe déjà sur cet appareil"}), 409

    if load_user_by_email(email):
        log_security_event(
            "register_blocked_existing_email",
            email=email,
            ip=ip_address,
        )
        return jsonify({"error": "Cet email est déjà utilisé"}), 409

    ref_code = data.get("ref", "").strip() or None

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
                ) VALUES (?, ?, ?, ?, ?)
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
                "SELECT * FROM users WHERE email = ?",
                (email,),
            ).fetchone()

            if ref_code:
                referrer = db.execute(
                    "SELECT id FROM users WHERE referral_code = ?",
                    (ref_code,),
                ).fetchone()
                if referrer and referrer["id"] != user["id"]:
                    db.execute(
                        "INSERT INTO referrals (referrer_id, referee_id) VALUES (?, ?)",
                        (referrer["id"], user["id"]),
                    )
                    db.commit()
        finally:
            db.close()

        register_device(device_id, user["id"])

        token = make_token(user)
        log_security_event("register_success", user_id=user["id"], email=email, ip=ip_address)

        # Send trial welcome email in background — never blocks the registration response
        import threading
        threading.Thread(
            target=send_trial_start_email,
            args=(email, name or ""),
            daemon=True,
        ).start()

        return jsonify(build_user_response(user, token)), 201
    except Exception:
        app.logger.exception("register_failed email=%s ip=%s", email, ip_address)
        return jsonify({"error": "Erreur interne"}), 500


@app.route("/auth/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    email = normalize_email(data.get("email", ""))
    password = data.get("password", "")
    device_id = data.get("device_id", "").strip() or None
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

    user = load_user_by_email(email)
    if not user or not check_password_hash(user["password_hash"], password):
        log_security_event("login_failed", email=email, ip=ip_address)
        return jsonify({"error": "Email ou mot de passe incorrect"}), 401

    if device_id and not device_id_is_valid(device_id):
        return jsonify({"error": "Identifiant appareil invalide"}), 400

    if device_id and device_id_is_stable(device_id):
        register_device(device_id, user["id"])
    elif device_id:
        log_security_event(
            "login_unstable_device_id_ignored",
            email=email,
            ip=ip_address,
        )

    token = make_token(user)
    log_security_event("login_success", user_id=user["id"], email=email, ip=ip_address)
    return jsonify(build_user_response(user, token))


@app.route("/auth/session", methods=["GET"])
@auth_required
def session(user):
    token = make_token(user)
    show_reminder = maybe_send_trial_reminder(user)
    return jsonify(build_user_response(user, token, show_trial_reminder=show_reminder))


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
):
    register_device(device_id, user["id"])
    bootstrap_device_entitlement(user, device_id, app_version, app_channel)
    entitlement = sync_device_entitlement_state(
        user,
        device_id,
        app_version=app_version,
        app_channel=app_channel,
    )
    integrity_evaluation = evaluate_build_integrity(
        user=user,
        device_id=device_id,
        app_channel=app_channel,
        integrity=integrity,
    )
    if not entitlement_allows_access(entitlement) or integrity_evaluation["blocked"]:
        return None, entitlement, integrity_evaluation
    return (
        build_license_payloads(
            user,
            entitlement,
            device_id=device_id,
            integrity_evaluation=integrity_evaluation,
        ),
        entitlement,
        integrity_evaluation,
    )


@app.route("/license/issue", methods=["POST"])
@auth_required
def issue_license(user):
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
        return jsonify({"error": "Accès premium inactif", "license": status_payload}), 403

    log_security_event(
        "license_issue_success",
        user_id=user["id"],
        device_id=device_id,
        status=entitlement["entitlement_status"] if entitlement else None,
    )
    return jsonify({"license": license_payload})


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
            SET weekly_transcription_count = ?,
                weekly_transcription_reset_at = ?
            WHERE id = ?
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

        customer_id = ensure_customer(user)
        checkout = stripe.checkout.Session.create(
            customer=customer_id,
            payment_method_types=["card"],
            line_items=[{"price": STRIPE_PRICE_ID, "quantity": 1}],
            mode="subscription",
            success_url=f"{APP_RETURN_URL}?checkout=success",
            cancel_url=f"{APP_RETURN_URL}?checkout=cancelled",
        )
        return jsonify({"url": checkout.url})
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
        trial_end: int | None = None,
        period_end: int | None = None,
    ):
        db = get_db()
        try:
            db.execute(
                """
                UPDATE users
                SET subscription_status = ?, trial_end = ?, period_end = ?
                WHERE stripe_customer_id = ?
                """,
                (status, to_iso(trial_end), to_iso(period_end), customer_id),
            )
            db.commit()
            row = db.execute(
                "SELECT id FROM users WHERE stripe_customer_id = ?",
                (customer_id,),
            ).fetchone()

            if row and status == "active":
                db.execute(
                    """
                    UPDATE referrals SET converted = 1
                    WHERE referee_id = ? AND converted = 0
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
        update_subscription(
            data["customer"],
            data["status"],
            data.get("trial_end"),
            data.get("current_period_end"),
        )
    elif event_type == "customer.subscription.deleted":
        update_subscription(
            data["customer"],
            "canceled",
            data.get("trial_end"),
            data.get("current_period_end"),
        )

    return jsonify({"ok": True})


@app.route("/admin/activate", methods=["POST"])
def admin_activate():
    data = request.get_json(silent=True) or {}
    email = normalize_email(data.get("email", ""))
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
        user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if not user:
            return jsonify({"error": "Utilisateur introuvable"}), 404

        far_future = datetime(2099, 12, 31, tzinfo=timezone.utc).isoformat()
        db.execute(
            """
            UPDATE users
            SET subscription_status = ?, period_end = ?
            WHERE email = ?
            """,
            ("active", far_future, email),
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
                WHERE user_id = ? AND device_id = ?
                """,
                (user_id, device_id),
            ).fetchone()
        else:
            entitlement = db.execute(
                """
                SELECT * FROM premium_device_entitlements
                WHERE device_id = ?
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
            SET entitlement_status = ?,
                revoked_at = ?,
                grace_until = ?,
                last_seen_at = ?
            WHERE id = ?
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
                "UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0",
                (user["id"],),
            )
            db.execute(
                """
                INSERT INTO password_reset_tokens (user_id, token, expires_at, used, attempt_count)
                VALUES (?, ?, ?, 0, 0)
                """,
                (user["id"], generate_password_hash(code), expires_at),
            )
            db.commit()
        finally:
            db.close()

        try:
            send_reset_email(email, code)
        except Exception:
            pass

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
            "UPDATE password_reset_tokens SET used = 1 WHERE user_id = ?",
            (user["id"],),
        )
        next_token_version = int(user["token_version"] or 0) + 1
        db.execute(
            "UPDATE users SET password_hash = ?, token_version = ? WHERE id = ?",
            (generate_password_hash(new_password), next_token_version, user["id"]),
        )
        db.commit()
        user = db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    finally:
        db.close()

    clear_rate_limit("reset_password:ip", client_ip)
    clear_rate_limit("reset_password:email", email)
    clear_rate_limit("verify_reset:ip", client_ip)
    clear_rate_limit("verify_reset:email", email)
    clear_rate_limit("forgot_password:email", email)
    token = make_token(user)
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
            "UPDATE users SET password_hash = ?, token_version = ? WHERE id = ?",
            (generate_password_hash(new_password), next_token_version, user["id"]),
        )
        db.commit()
    finally:
        db.close()

    log_security_event("change_password_success", user_id=user["id"], ip=ip_address)
    return jsonify({"ok": True})


REFERRAL_BASE_URL = os.environ.get("REFERRAL_BASE_URL", "https://vocalype.com/r")


def _get_or_create_referral_code(user, db: sqlite3.Connection) -> str:
    """Return the user's referral code, creating one if it doesn't exist yet."""
    code = user["referral_code"]
    if code:
        return code
    code = secrets.token_urlsafe(8)
    db.execute("UPDATE users SET referral_code = ? WHERE id = ?", (code, user["id"]))
    db.commit()
    return code


@app.route("/referral/code", methods=["GET"])
@auth_required
def get_referral_code(user):
    db = get_db()
    try:
        # Reload fresh row so referral_code is up to date
        row = db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
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
            WHERE referrer_id = ?
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


if __name__ == "__main__":
    require_secret_configured()
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
