const EXA_URL = "https://api.exa.ai/search";
const CONTENTS_URL = "https://api.exa.ai/contents";

// Longest bit of Exa's own error message we pass on. Enough to say what went wrong.
const ERROR_TEXT = 200;

// What one search cost on 2026-10-30. Charged when a reply comes back without a price we can read, so a search
// never counts as free.
export const SEARCH_USD = 0.007;

// What one page's text costs, charged the same way when Exa's reply has no price we can read.
export const CONTENTS_USD = 0.001;

// Results per search. Exa's default of 10 came to about 22,000 characters, and every search stays in the
// conversation, so it's re-sent on every later step. 5 is about half that, and the agent can search again if they
// miss. Exa's guide says to set this only on purpose, and this is the purpose (problem #24).
export const RESULTS = 5;

// The only class that talks to Exa, the way AiClient is the only one that talks to Together. fetch is handed in so a
// test can give it a fake one and nothing goes over the network.
export class ExaClient
  {
    constructor({ apiKey, fetch = globalThis.fetch })
      {
        this.apiKey = apiKey;
        this.fetch = fetch;
      }

    // One search, sent the way Exa's own guide says to: the query plus short highlights from each page, and nothing
    // else but our result count. Gives back Exa's results and what the search cost. The signal goes to fetch, so a tool that runs out of
    // time actually stops.
    async search(query, signal)
      {
        const response = await this.fetch(EXA_URL, { method: "POST", headers: this.headers(), body: JSON.stringify(this.body(query)), signal });
        if(!response.ok) throw await this.failure(response);
        const reply = await response.json();
        return { results: reply.results || [], cost: this.costOf(reply) };
      }

    // One page's text by its link, from Exa's copy of it, for pages our server can't open itself (LinkedIn) or that
    // only fill in with JavaScript (Workday). Sent the way Exa's guide says: the link plus text, nothing else. Exa
    // answers 200 even when that page failed, so the page's own status is checked, and a failed page comes back as
    // empty text, still paid for.
    async contents(url, signal)
      {
        const response = await this.fetch(CONTENTS_URL, { method: "POST", headers: this.headers(), body: JSON.stringify({ urls: [url], text: true }), signal });
        if(!response.ok) throw await this.failure(response);
        const reply = await response.json();
        const cost = this.costOf(reply, CONTENTS_USD);
        const failed = reply.statuses?.[0] && reply.statuses[0].status !== "success";
        const text = failed ? "" : reply.results?.[0]?.text || "";
        return { text: typeof text === "string" ? text : "", cost };
      }

    // Exa puts each call's price in costDollars.total. A price that's missing, negative or not a number is charged
    // at the usual price instead, so it can't make a call free or lower the day's total.
    costOf(reply, usual = SEARCH_USD)
      {
        const cost = reply.costDollars?.total;
        return Number.isFinite(cost) && cost >= 0 ? cost : usual;
      }

    headers()
      {
        return { "Content-Type": "application/json", "x-api-key": this.apiKey };
      }

    body(query)
      {
        return { query, type: "auto", numResults: RESULTS, contents: { highlights: true } };
      }

    // Turning Exa's refusal into a sentence the model and the run log can read. A bad key gets its own message
    // because the model can't fix that one, only you can.
    async failure(response)
      {
        if(response.status === 401) return new Error("Exa refused the API key. Check EXA_API_KEY in the server's .env.");
        if(response.status === 429) return new Error("Exa is getting too many searches right now. Try again in a bit.");
        return new Error(`Exa said no (${response.status}): ${await this.reason(response)}`);
      }

    // Exa sends { error: "..." } when it can, but a proxy in the way might send a page of HTML instead.
    async reason(response)
      {
        const text = await response.text().catch(() => "");
        try
          {
            return String(JSON.parse(text).error || text).slice(0, ERROR_TEXT);
          }
        catch
          {
            return text.slice(0, ERROR_TEXT) || "no reason given";
          }
      }
  }
