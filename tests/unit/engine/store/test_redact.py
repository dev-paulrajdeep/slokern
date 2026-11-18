"""
Purpose: Unit tests for engine/store/redact.
Owner: Rajdeep
Authority: Aligned with AGENTS.md Section 9 and Section 12
"""

from slokern.engine.store.redact import sanitize_secret_message


def test_sanitize_empty_and_falsy():
    assert sanitize_secret_message("") == ""
    assert sanitize_secret_message(None) == ""


def test_sanitize_explicit_secret_key():
    secret = "sk-super-secret-key-12345"
    text = f"Connection failed to endpoint with key {secret} after timeout"
    sanitized = sanitize_secret_message(text, secret_key=secret)
    assert secret not in sanitized
    assert "***REDACTED***" in sanitized
    assert sanitized == "Connection failed to endpoint with key ***REDACTED*** after timeout"


def test_sanitize_explicit_secret_key_short_ignored():
    short_secret = "abc"
    text = "alphabetical abc order"
    # When secret_key length < 4, it should not be blindly replaced
    sanitized = sanitize_secret_message(text, secret_key=short_secret)
    assert sanitized == text


def test_sanitize_bearer_token():
    cases = [
        ("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "Authorization: Bearer ***REDACTED***"),
        ("bearer 1234567890abcdef", "bearer ***REDACTED***"),
        ("BEARER my-secret-token-value", "BEARER ***REDACTED***"),
    ]
    for raw, expected in cases:
        assert sanitize_secret_message(raw) == expected


def test_sanitize_api_key_patterns():
    cases = [
        ("api_key = 'abcdef123456'", "api_key = '***REDACTED***'"),
        ('api-key: "secret123456"', 'api-key: "***REDACTED***"'),
        ("token: secret_value_999", "token: ***REDACTED***"),
        ("secret = 'supertopsecret'", "secret = '***REDACTED***'"),
        ('password="correct-horse-battery"', 'password="***REDACTED***"'),
        ('{"api_key": "json_secret_12345"}', '{"api_key": "***REDACTED***"}'),
        ('{"token": "auth_token_9999"}', '{"token": "***REDACTED***"}'),
    ]
    for raw, expected in cases:
        assert sanitize_secret_message(raw) == expected


def test_sanitize_preserves_innocent_strings():
    text = "HTTP 200 OK: Request completed in 14.2ms with 64 tokens"
    assert sanitize_secret_message(text) == text


def test_sanitize_combined_secrets():
    raw = "Error sending Bearer sk-xyz123456789 with api_key: 'key987654321'"
    sanitized = sanitize_secret_message(raw)
    assert "sk-xyz123456789" not in sanitized
    assert "key987654321" not in sanitized
    assert sanitized == "Error sending Bearer ***REDACTED*** with api_key: '***REDACTED***'"
