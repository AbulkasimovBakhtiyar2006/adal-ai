"""Google identity verification and revocable browser sessions (no OAuth tokens stored)."""

import hashlib
import secrets
import time

from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token

AUTH_COOKIE = "adal_account"
AUTH_TTL = 7 * 86400


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def initialize(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS accounts (
            id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
            name TEXT NOT NULL, email TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS account_tokens (
            token TEXT PRIMARY KEY, account TEXT NOT NULL
                REFERENCES accounts(id) ON DELETE CASCADE,
            expires REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS login_challenges (
            nonce TEXT PRIMARY KEY, session TEXT NOT NULL
                REFERENCES sessions(id) ON DELETE CASCADE,
            expires REAL NOT NULL
        );
    """)


def account(store, token):
    if not token:
        return None
    with store.connect() as db:
        db.execute("DELETE FROM account_tokens WHERE expires < ?", (time.time(),))
        row = db.execute(
            "SELECT a.id, a.name, a.email FROM accounts a JOIN account_tokens t "
            "ON a.id=t.account WHERE t.token=?", (digest(token),)
        ).fetchone()
    return dict(zip(("id", "name", "email"), row, strict=True)) if row else None


def challenge(store, session):
    nonce = secrets.token_urlsafe(32)
    with store.connect() as db:
        db.execute("DELETE FROM login_challenges WHERE expires < ?", (time.time(),))
        db.execute("INSERT INTO login_challenges VALUES (?, ?, ?)",
                   (nonce, session, time.time() + 600))
    return nonce


def verify_credential(credential, client_id):
    # google-auth checks signature, issuer, audience and expiry. Bound network timeout.
    transport = GoogleRequest()

    def fetch_keys(*args, **kwargs):
        kwargs["timeout"] = 10
        return transport(*args, **kwargs)

    try:
        claims = id_token.verify_oauth2_token(credential, fetch_keys, client_id)
    except (ValueError, GoogleAuthError) as exc:
        raise ValueError("invalid_google_credential") from exc
    if (not isinstance(claims.get("sub"), str) or not claims["sub"]
            or claims.get("email_verified") is not True
            or not isinstance(claims.get("email"), str)):
        raise ValueError("invalid_google_identity")
    return claims


def login(store, session, claims, old_token):
    token = secrets.token_urlsafe(32)
    key = "google:" + digest(claims["sub"])
    with store.connect() as db:
        consumed = db.execute(
            "DELETE FROM login_challenges WHERE nonce=? AND session=? AND expires>?",
            (claims.get("nonce", ""), session, time.time()),
        )
        if consumed.rowcount != 1:
            raise ValueError("invalid_login_challenge")
        # Account data survives expiry of an individual browser's login session.
        db.execute("INSERT OR IGNORE INTO sessions VALUES (?, ?)", (key, 253402300799))
        db.execute("INSERT INTO accounts VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE "
                   "SET name=excluded.name, email=excluded.email",
                   (key, str(claims.get("name") or claims["email"])[:200], claims["email"][:320]))
        if old_token:
            db.execute("DELETE FROM account_tokens WHERE token=?", (digest(old_token),))
        db.execute("INSERT INTO account_tokens VALUES (?, ?, ?)",
                   (digest(token), key, time.time() + AUTH_TTL))
    return token


def logout(store, token):
    with store.connect() as db:
        db.execute("DELETE FROM account_tokens WHERE token=?", (digest(token or ""),))
