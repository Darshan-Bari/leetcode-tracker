"""Minimal FastAPI backend for GitHub OAuth code exchange.

This service owns the GitHub Client Secret and is the only component that
talks to GitHub's token endpoint. The browser extension never stores or sends
the secret.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import FastAPI, HTTPException
from dotenv import load_dotenv
from pydantic import BaseModel, Field


GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"

load_dotenv(Path(__file__).with_name(".env"))
load_dotenv()


class GitHubAuthRequest(BaseModel):
    """Request payload accepted by POST /auth/github."""

    code: str = Field(..., min_length=1)
    state: Optional[str] = None
    redirect_uri: str = Field(..., min_length=1)
    client_id: str = Field(..., min_length=1)
    code_verifier: Optional[str] = None


app = FastAPI(title="LeetCode Tracker Auth Backend", version="1.0.0")


@app.post("/auth/github")
async def exchange_github_code(payload: GitHubAuthRequest) -> dict[str, Any]:
    """Exchange a GitHub OAuth code for an access token.

    The backend validates its own configuration, forwards the authorization code
    to GitHub, and returns GitHub's token response to the extension.
    """

    github_client_id = os.getenv("GITHUB_CLIENT_ID")
    github_client_secret = os.getenv("GITHUB_CLIENT_SECRET")
    github_redirect_uri = os.getenv("GITHUB_REDIRECT_URI")

    if not github_client_id or not github_client_secret or not github_redirect_uri:
        raise HTTPException(
            status_code=500,
            detail="Backend OAuth configuration is incomplete.",
        )

    if payload.client_id != github_client_id:
        raise HTTPException(status_code=400, detail="Client ID mismatch.")

    if payload.redirect_uri != github_redirect_uri:
        raise HTTPException(status_code=400, detail="Redirect URI mismatch.")

    form_data = {
        "client_id": github_client_id,
        "client_secret": github_client_secret,
        "code": payload.code,
        "redirect_uri": github_redirect_uri,
    }

    if payload.state:
        form_data["state"] = payload.state

    if payload.code_verifier:
        form_data["code_verifier"] = payload.code_verifier

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            GITHUB_TOKEN_URL,
            data=form_data,
            headers={"Accept": "application/json"},
        )

    token_payload = response.json()

    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=token_payload.get("error_description")
            or token_payload.get("error")
            or "GitHub token exchange failed.",
        )

    return {
        "access_token": token_payload.get("access_token"),
        "token_type": token_payload.get("token_type"),
        "scope": token_payload.get("scope"),
        "state": payload.state,
    }


@app.get("/health")
async def health() -> dict[str, str]:
    """Simple readiness endpoint."""

    return {"status": "ok"}