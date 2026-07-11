"""FastAPI backend for GitHub OAuth code exchange.

The backend owns the GitHub Client Secret and exchanges OAuth codes on behalf
of the Firefox extension. The extension never stores or transmits the secret.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field


GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
SERVICE_NAME = "LeetCode Tracker OAuth Backend"
APP_VERSION = "1.1.0"
TOKEN_REQUEST_TIMEOUT = httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0)
# Security configuration for CORS.
# We restrict allowed origins exclusively to Firefox WebExtensions.
# Localhost and 127.0.0.1 are explicitly removed to prevent cross-origin
# attacks in production.
ALLOWED_ORIGIN_REGEX = r"^moz-extension://[a-f0-9-]+$"

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("leetcode_tracker.oauth_backend")

load_dotenv(Path(__file__).with_name(".env"))
load_dotenv()


@dataclass(frozen=True)
class BackendSettings:
    """Validated backend configuration loaded from environment variables."""

    github_client_id: str
    github_client_secret: str
    github_redirect_uri: str


class GitHubAuthRequest(BaseModel):
    """Request payload accepted by POST /auth/github."""

    code: str = Field(..., min_length=1)
    state: Optional[str] = None
    redirect_uri: str = Field(..., min_length=1)
    client_id: str = Field(..., min_length=1)
    code_verifier: Optional[str] = None


class APIError(Exception):
    """Structured API error returned as JSON."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def log_event(level: int, event: str, **fields: Any) -> None:
    """Emit a structured log line without secrets."""

    payload = {"event": event, "service": SERVICE_NAME, "version": APP_VERSION}
    payload.update(fields)
    logger.log(level, json.dumps(payload, sort_keys=True))


def safe_github_configured() -> bool:
    """Return whether the minimum GitHub OAuth configuration is present."""

    return all(
        os.getenv(name)
        for name in ("GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GITHUB_REDIRECT_URI")
    )


@lru_cache(maxsize=1)
def get_settings() -> BackendSettings:
    """Load and validate backend settings from environment variables."""

    github_client_id = os.getenv("GITHUB_CLIENT_ID")
    github_client_secret = os.getenv("GITHUB_CLIENT_SECRET")
    github_redirect_uri = os.getenv("GITHUB_REDIRECT_URI")

    missing_variables = [
        name
        for name, value in (
            ("GITHUB_CLIENT_ID", github_client_id),
            ("GITHUB_CLIENT_SECRET", github_client_secret),
            ("GITHUB_REDIRECT_URI", github_redirect_uri),
        )
        if not value
    ]

    if missing_variables:
        raise APIError(
            status_code=500,
            code="missing_backend_configuration",
            message=(
                "Backend OAuth configuration is incomplete. "
                f"Missing: {', '.join(missing_variables)}."
            ),
        )


    return BackendSettings(
        github_client_id=github_client_id,
        github_client_secret=github_client_secret,
        github_redirect_uri=github_redirect_uri,
    )


def classify_github_oauth_error(error: str | None, description: str | None) -> tuple[str, str]:
    """Map GitHub OAuth failures to stable API error codes and messages."""

    normalized_error = (error or "").strip().lower()
    normalized_description = (description or "").strip().lower()

    if "expired" in normalized_description:
        return (
            "expired_oauth_code",
            "The GitHub authorization code expired. Please start the login flow again.",
        )

    if normalized_error in {"bad_verification_code", "invalid_grant"}:
        return (
            "invalid_oauth_code",
            "The GitHub authorization code is invalid or has already been used.",
        )

    if normalized_error == "redirect_uri_mismatch":
        return (
            "invalid_redirect_uri",
            "The GitHub redirect URI does not match the configured callback URL.",
        )

    if normalized_error == "incorrect_client_credentials":
        return (
            "client_id_mismatch",
            "The GitHub client configuration does not match the backend settings.",
        )

    return (
        "oauth_exchange_failed",
        description or error or "GitHub token exchange failed.",
    )


def build_error_response(status_code: int, code: str, message: str) -> JSONResponse:
    """Create a consistent JSON error response."""

    return JSONResponse(
        status_code=status_code,
        content={"success": False, "message": message, "code": code},
    )


app = FastAPI(title=SERVICE_NAME, version=APP_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Accept", "Content-Type"],
)


@app.exception_handler(APIError)
async def api_error_handler(_request: Request, exc: APIError) -> JSONResponse:
    """Render structured API errors."""

    if exc.status_code >= 500:
        log_event(logging.ERROR, "api_error", code=exc.code, message=exc.message)

    return build_error_response(exc.status_code, exc.code, exc.message)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Return a stable validation error payload."""

    return build_error_response(
        422,
        "validation_error",
        "The request payload is invalid.",
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    """Normalize HTTP exceptions into the backend response format."""

    code = "http_error"
    message = str(exc.detail)

    if exc.status_code == 400 and "Client ID mismatch" in message:
        code = "client_id_mismatch"
    elif exc.status_code == 400 and "Redirect URI mismatch" in message:
        code = "invalid_redirect_uri"
    elif exc.status_code >= 500:
        code = "missing_backend_configuration"

    return build_error_response(exc.status_code, code, message)


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    """Return a generic error for unexpected failures."""

    log_event(logging.ERROR, "unhandled_exception", error_type=type(exc).__name__)
    return build_error_response(
        500,
        "internal_server_error",
        "An unexpected backend error occurred.",
    )


@app.get("/")
async def root() -> dict[str, str]:
    """Deployment verification endpoint."""

    return {"service": SERVICE_NAME, "version": APP_VERSION, "status": "running"}


@app.get("/health")
async def health() -> dict[str, Any]:
    """Health endpoint used by deployment checks."""

    return {
        "status": "ok",
        "service": SERVICE_NAME,
        "version": APP_VERSION,
        "github_configured": safe_github_configured(),
    }


@app.post("/auth/github")
async def exchange_github_code(payload: GitHubAuthRequest) -> dict[str, Any]:
    """Exchange a GitHub OAuth code for an access token."""

    settings = get_settings()

    if payload.client_id != settings.github_client_id:
        raise APIError(
            status_code=400,
            code="client_id_mismatch",
            message="The GitHub client ID does not match the backend configuration.",
        )

    if payload.redirect_uri != settings.github_redirect_uri:
        raise APIError(
            status_code=400,
            code="invalid_redirect_uri",
            message="The redirect URI does not match the configured callback URL.",
        )

    form_data = {
        "client_id": settings.github_client_id,
        "client_secret": settings.github_client_secret,
        "code": payload.code,
        "redirect_uri": settings.github_redirect_uri,
    }

    if payload.state:
        form_data["state"] = payload.state

    if payload.code_verifier:
        form_data["code_verifier"] = payload.code_verifier

    log_event(
        logging.INFO,
        "oauth_started",
        has_state=bool(payload.state),
        has_code_verifier=bool(payload.code_verifier),
    )

    last_network_error: str | None = None

    for attempt in range(2):
        try:
            async with httpx.AsyncClient(timeout=TOKEN_REQUEST_TIMEOUT) as client:
                log_event(logging.INFO, "github_request", attempt=attempt + 1)
                response = await client.post(
                    GITHUB_TOKEN_URL,
                    data=form_data,
                    headers={"Accept": "application/json"},
                )

            log_event(
                logging.INFO,
                "github_response",
                attempt=attempt + 1,
                status_code=response.status_code,
            )

            try:
                token_payload = response.json()
            except ValueError as exc:
                if response.status_code >= 500 and attempt == 0:
                    continue

                raise APIError(
                    status_code=502,
                    code="github_unavailable",
                    message="GitHub returned an invalid response during token exchange.",
                ) from exc

            if response.status_code >= 500:
                if attempt == 0:
                    continue

                raise APIError(
                    status_code=502,
                    code="github_unavailable",
                    message="GitHub is temporarily unavailable.",
                )

            error = token_payload.get("error")
            if error:
                code, message = classify_github_oauth_error(
                    error,
                    token_payload.get("error_description"),
                )
                raise APIError(status_code=400, code=code, message=message)

            access_token = token_payload.get("access_token")
            if not access_token:
                raise APIError(
                    status_code=502,
                    code="github_unavailable",
                    message="GitHub did not return an access token.",
                )

            log_event(logging.INFO, "oauth_success")

            return {
                "success": True,
                "access_token": access_token,
                "token_type": token_payload.get("token_type"),
                "scope": token_payload.get("scope"),
                "state": payload.state,
            }

        except httpx.TimeoutException as exc:
            last_network_error = "upstream_timeout"
            log_event(logging.WARNING, "timeout", attempt=attempt + 1)
            if attempt == 0:
                continue

            raise APIError(
                status_code=504,
                code="upstream_timeout",
                message="GitHub did not respond before the request timed out.",
            ) from exc

        except httpx.TransportError as exc:
            last_network_error = "network_failure"
            log_event(logging.WARNING, "network_failure", attempt=attempt + 1)
            if attempt == 0:
                continue

            raise APIError(
                status_code=502,
                code="network_failure",
                message="A network error occurred while contacting GitHub.",
            ) from exc

    raise APIError(
        status_code=502,
        code=last_network_error or "github_unavailable",
        message="GitHub token exchange failed.",
    )


