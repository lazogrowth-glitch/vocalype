#!/usr/bin/env python3
import argparse
import base64
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request


DEFAULT_AUDIENCE = "vocaltype-admin"
DEFAULT_SCOPE = "admin:activate"
DEFAULT_TTL_SECONDS = 300


def base64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def encode_hs256_jwt(payload: dict[str, object], secret: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    header_segment = base64url_encode(
        json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    payload_segment = base64url_encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    signing_input = f"{header_segment}.{payload_segment}".encode("ascii")
    signature = hmac.new(
        secret.encode("utf-8"),
        signing_input,
        hashlib.sha256,
    ).digest()
    return f"{header_segment}.{payload_segment}.{base64url_encode(signature)}"


def env_int(name: str, default: int, minimum: int) -> int:
    try:
        return max(minimum, int(os.environ.get(name, str(default))))
    except (TypeError, ValueError):
        return default


def normalize_base_url(raw_value: str) -> str:
    value = raw_value.strip().rstrip("/")
    if not value:
        raise ValueError("Missing API base URL. Set VOCALTYPE_API_URL or pass --api-url.")
    if not value.startswith(("http://", "https://")):
        raise ValueError("API URL must start with http:// or https://")
    return value


def generate_token(subject: str, audience: str, ttl_seconds: int, secret: str) -> str:
    now = int(time.time())
    payload = {
        "sub": subject,
        "scope": DEFAULT_SCOPE,
        "aud": audience,
        "iat": now,
        "exp": now + max(60, ttl_seconds),
    }
    return encode_hs256_jwt(payload, secret)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Activate a VocalType user through the admin endpoint."
    )
    parser.add_argument("--email", required=True, help="User email to activate.")
    parser.add_argument(
        "--api-url",
        default=os.environ.get("VOCALTYPE_API_URL", ""),
        help="Backend base URL, e.g. https://your-api.up.railway.app",
    )
    parser.add_argument(
        "--subject",
        default=os.environ.get("ADMIN_TOKEN_SUBJECT", "local-admin"),
        help="Admin subject recorded in backend audit logs.",
    )
    parser.add_argument(
        "--audience",
        default=os.environ.get("ADMIN_TOKEN_AUDIENCE", DEFAULT_AUDIENCE),
        help="JWT audience expected by the backend.",
    )
    parser.add_argument(
        "--ttl-seconds",
        type=int,
        default=env_int("ADMIN_TOKEN_MAX_AGE_SECONDS", DEFAULT_TTL_SECONDS, 60),
        help="Token lifetime in seconds.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the request details without sending it.",
    )
    args = parser.parse_args()

    secret = os.environ.get("ADMIN_TOKEN_SECRET", "").strip()
    if not secret:
        print("Missing ADMIN_TOKEN_SECRET in the environment.", file=sys.stderr)
        return 1

    try:
        api_url = normalize_base_url(args.api_url)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1

    email = args.email.strip().lower()
    if not email or "@" not in email:
        print("Please provide a valid --email.", file=sys.stderr)
        return 1

    subject = args.subject.strip() or "local-admin"
    audience = args.audience.strip() or DEFAULT_AUDIENCE
    token = generate_token(subject, audience, args.ttl_seconds, secret)
    endpoint = f"{api_url}/admin/activate"
    body = json.dumps({"email": email}).encode("utf-8")

    if args.dry_run:
        print("POST", endpoint)
        print("Authorization: Bearer <redacted>")
        print(body.decode("utf-8"))
        return 0

    request = urllib.request.Request(
        endpoint,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = response.read().decode("utf-8")
            print(payload)
            return 0
    except urllib.error.HTTPError as error:
        body_text = error.read().decode("utf-8", errors="replace")
        print(body_text or f"HTTP {error.code}", file=sys.stderr)
        return 1
    except urllib.error.URLError as error:
        print(f"Request failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
