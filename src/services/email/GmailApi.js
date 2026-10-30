// The two Gmail calls the check needs: list the messages a search finds, and open one. Read-only, with an access
// token Connect Gmail hands over. Same calls as JobNavigator's check_emails (users/me/messages with
// includeSpamTrash, then each message in full).
//
// One fix to theirs: they read only the first 20 results and never the next page, so a busy week pushed real
// replies out of reach. This follows Gmail's page tokens up to `most` ids.
//
// fetch gets handed in, so tests answer for Gmail.

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

// Gmail's own most per page.
const PAGE = 500;

// How long one call gets.
const CALL_MS = 15_000;

export class GmailError extends Error
  {
    constructor(status, message)
      {
        super(message);
        this.status = status;
      }
  }

export class GmailApi
  {
    constructor({ fetch = globalThis.fetch, callMs = CALL_MS } = {})
      {
        this.fetch = fetch;
        this.callMs = callMs;
      }

    // The ids a search finds, newest first, at most `most` of them.
    async ids(token, query, { most = PAGE, signal } = {})
      {
        const ids = [];
        let pageToken;
        do
          {
            const page = await this.page(token, query, { size: Math.min(PAGE, most - ids.length), pageToken, signal });
            ids.push(...(page.messages || []).map((message) => message.id));
            pageToken = page.nextPageToken;
          }
        while(pageToken && ids.length < most);
        return ids.slice(0, most);
      }

    page(token, query, { size, pageToken, signal })
      {
        const params = new URLSearchParams({ q: query, maxResults: String(size), includeSpamTrash: "true" });
        if(pageToken) params.set("pageToken", pageToken);
        return this.get(token, `/messages?${params}`, signal);
      }

    // One message in full: headers, and the body in all its parts.
    message(token, id, signal)
      {
        return this.get(token, `/messages/${encodeURIComponent(id)}?format=full`, signal);
      }

    // One GET with the token, cut off after callMs or when the run stops. Anything but a 200 is a GmailError carrying
    // Gmail's status, so a 401 can tell Connect Gmail the token's dead.
    async get(token, path, signal)
      {
        const timeout = AbortSignal.timeout(this.callMs);
        const response = await this.fetch(BASE + path,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          });
        if(!response.ok) throw new GmailError(response.status, `Gmail answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
        return response.json();
      }
  }
