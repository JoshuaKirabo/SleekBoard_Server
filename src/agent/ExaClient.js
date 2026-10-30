const EXA_URL = "https://api.exa.ai/search";

// Longest bit of Exa's own error message we pass on. Enough to say what went wrong.
const ERROR_TEXT = 200;

// What one search cost on 2026-10-30. Charged when a reply comes back without a price we can read, so a search
// never counts as free.
export const SEARCH_USD = 0.007;

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
    // else. Gives back Exa's results and what the search cost. The signal goes to fetch, so a tool that runs out of
    // time actually stops.
    async search(query, signal)
      {
        const response = await this.fetch(EXA_URL, { method: "POST", headers: this.headers(), body: JSON.stringify(this.body(query)), signal });
        if(!response.ok) throw await this.failure(response);
        const reply = await response.json();
        return { results: reply.results || [], cost: this.costOf(reply) };
      }

    // Exa puts each search's price in costDollars.total. A price that's missing, negative or not a number is charged
    // at the usual price instead, so it can't make a search free or lower the day's total.
    costOf(reply)
      {
        const cost = reply.costDollars?.total;
        return Number.isFinite(cost) && cost >= 0 ? cost : SEARCH_USD;
      }

    headers()
      {
        return { "Content-Type": "application/json", "x-api-key": this.apiKey };
      }

    body(query)
      {
        return { query, type: "auto", contents: { highlights: true } };
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
