#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import secrets
import smtplib
import sqlite3
import re
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from functools import wraps
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
APP_RETURN_URL = os.environ.get(
    "APP_RETURN_URL",
    os.environ.get("FRONTEND_URL", "https://vocaltypeai.com"),
)
DATABASE_PATH = os.environ.get("DATABASE_PATH", "vocaltype.db")

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


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def client_ip() -> str:
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.remote_addr or "unknown"


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
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip() or "unknown"
    return request.remote_addr or "unknown"


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


def has_access(user) -> bool:
    status = user["subscription_status"]
    if status == "active":
        return True

    if status == "trialing":
        trial_end = parse_iso(user["trial_end"])
        if not trial_end:
            return False
        return utc_now() < trial_end

    return False


def build_user_response(user, token: str):
    return {
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
            "has_access": has_access(user),
        },
    }


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
    if ADMIN_SECRET:
        app.logger.warning(
            "ADMIN_SECRET is deprecated; use short-lived admin JWTs signed with ADMIN_TOKEN_SECRET instead"
        )


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

    try:
        trial_end = (utc_now() + timedelta(days=7)).isoformat()
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
        finally:
            db.close()

        register_device(device_id, user["id"])

        token = make_token(user)
        log_security_event("register_success", user_id=user["id"], email=email, ip=ip_address)
        return jsonify(build_user_response(user, token)), 201
    except Exception as exc:
        app.logger.exception("register_failed email=%s ip=%s", email, ip_address)
        return jsonify({"error": str(exc)}), 500


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

    if device_id:
        register_device(device_id, user["id"])

    token = make_token(user)
    log_security_event("login_success", user_id=user["id"], email=email, ip=ip_address)
    return jsonify(build_user_response(user, token))


@app.route("/auth/session", methods=["GET"])
@auth_required
def session(user):
    token = make_token(user["id"])
    return jsonify(build_user_response(user, token))


@app.route("/billing/checkout", methods=["POST"])
@auth_required
def billing_checkout(user):
    try:
        require_billing_configured()
        if has_access(user):
            return jsonify({"error": "Accès déjà actif"}), 400

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
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


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
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


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
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400

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
        finally:
            db.close()

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
        ip=ip_address,
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
        f"reset_password:ip:{ip_address}",
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
    token = make_token(user["id"])
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


if __name__ == "__main__":
    require_secret_configured()
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
