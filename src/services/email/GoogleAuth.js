// Google's side of Connect Gmail, ported from JobNavigator's email_monitor/gmail_auth.py (consent_url) and
// gmail_client.py (_get_access_token), plus the code swap in api/routes_gmail.py. Read-only Gmail and nothing else.
//
// JobNavigator is MIT licensed: Copyright (c) 2026 JobNavigator Contributors.
// https://github.com/vesaias/JobNavigator/blob/main/backend/email_monitor/gmail_auth.py

export const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALL_MS = 15_000;

// Google refusing a login. invalidGrant means it's dead for good (revoked, or the 7 days Google gives an app in
// testing are up), and only connecting again fixes it.
export class GoogleAuthError extends Error
  {
    constructor(message, { invalidGrant = false } = {})
      {
        super(message);
        this.invalidGrant = invalidGrant;
      }
  }

export class GoogleAuth
  {
    constructor({ clientId, clientSecret, redirectUri, fetch = globalThis.fetch })
      {
        this.clientId = String(clientId || "").trim();
        this.clientSecret = String(clientSecret || "").trim();
        this.redirectUri = redirectUri;
        this.fetch = fetch;
      }

    // True once GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are in .env.
    configured()
      {
        return Boolean(this.clientId && this.clientSecret);
      }

    // Google's consent screen. offline and consent make Google hand back a refresh token every time, not just the first.
    consentUrl(state)
      {
        const params = new URLSearchParams(
          {
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            response_type: "code",
            scope: SCOPE,
            access_type: "offline",
            prompt: "consent",
            include_granted_scopes: "true",
            state,
          });
        return `${AUTH_URL}?${params}`;
      }

    // The code Google sent back, swapped for the long-lived refresh token.
    async exchange(code)
      {
        const reply = await this.token({ code, grant_type: "authorization_code", redirect_uri: this.redirectUri });
        if(!reply.refresh_token) throw new GoogleAuthError("Google didn't send a refresh token.");
        return reply.refresh_token;
      }

    // A fresh access token from the refresh token: { token, expiresIn } in seconds.
    async refresh(refreshToken)
      {
        const reply = await this.token({ refresh_token: refreshToken, grant_type: "refresh_token" });
        if(!reply.access_token) throw new GoogleAuthError("Google didn't send an access token.");
        return { token: reply.access_token, expiresIn: Number(reply.expires_in) || 3600 };
      }

    // One POST to Google's token endpoint. Its error codes come back as GoogleAuthError, and invalid_grant is flagged.
    async token(fields)
      {
        const body = new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, ...fields });
        const response = await this.fetch(TOKEN_URL, { method: "POST", body, signal: AbortSignal.timeout(CALL_MS) });
        const reply = await response.json().catch(() => ({}));
        if(response.ok) return reply;
        throw new GoogleAuthError(`Google refused the login (${response.status} ${reply.error || ""}).`.replace(" )", ")"), { invalidGrant: reply.error === "invalid_grant" });
      }
  }
