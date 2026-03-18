#!/usr/bin/env python3
import argparse
import base64
import hashlib
import hmac
import json
import os
import sys
import time


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


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate a short-lived admin JWT for VocalType backend endpoints."
    )
    parser.add_argument(
        "--subject",
        default=os.environ.get("ADMIN_TOKEN_SUBJECT", "local-admin"),
        help="Admin subject recorded in the token and backend audit logs.",
    )
    parser.add_argument(
        "--scope",
        default=os.environ.get("ADMIN_TOKEN_SCOPE", DEFAULT_SCOPE),
        help="Space-delimited admin scopes to embed in the token.",
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
        "--raw",
        action="store_true",
        help="Print only the JWT token.",
    )
    args = parser.parse_args()

    secret = os.environ.get("ADMIN_TOKEN_SECRET", "").strip()
    if not secret:
        print("Missing ADMIN_TOKEN_SECRET in the environment.", file=sys.stderr)
        return 1

    now = int(time.time())
    payload = {
        "sub": args.subject.strip() or "local-admin",
        "scope": args.scope.strip() or DEFAULT_SCOPE,
        "aud": args.audience.strip() or DEFAULT_AUDIENCE,
        "iat": now,
        "exp": now + max(60, args.ttl_seconds),
    }
    token = encode_hs256_jwt(payload, secret)

    if args.raw:
        print(token)
        return 0

    print("Admin JWT:")
    print(token)
    print()
    print("Authorization header:")
    print(f"Bearer {token}")
    print()
    print("Example curl:")
    print(
        "curl -X POST \"$VOCALTYPE_API_URL/admin/activate\" "
        "-H \"Authorization: Bearer "
        f"{token}"
        "\" "
        "-H \"Content-Type: application/json\" "
        "-d '{\"email\":\"user@example.com\"}'"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
