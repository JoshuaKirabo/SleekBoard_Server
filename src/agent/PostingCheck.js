import { PageText } from "./tools/PageText.js";

// How much of the page the check reads. The start of a page says what it is, and 3,000 characters is about 700 tokens.
const SAMPLE = 3_000;

// Less text than this means the page didn't really load: one that only shows its text with JavaScript, or one that
// turns us away (LinkedIn). Then the link alone is judged, leaning towards "job", so a real posting isn't refused.
const THIN = 200;

// How a refused link's run error starts. The add sheet looks for it to show "Not a job" instead of guessing from the URL.
export const NOT_A_JOB = "Not a job";

const SYSTEM = `You check whether a web page is a job posting: one specific job someone can apply for. A list of many jobs, a company's home page, an article, a product, a tool or a profile is not one.
Answer with one line and nothing else: "job", or "not a job: " and the reason in under 12 words.`;

// The cheap first look in Fill in: is this link a job posting at all? It runs on the bottom rung (GLM 5.3 Flash, about
// $0.0001 a check), before the contact model reads anything, so a link to a tool, an article or a search page stops
// there instead of turning into a made-up card. Picked by a bake-off on 10 real links on 2026-10-30: GLM 5.3 Flash got
// all 10; the only cheaper models Together serves without a dedicated server got 8 (Qwen2 1.5B) and 0 (Qwen3.5 9B,
// which spent its whole reply thinking).
//
// clientFor() gives the AiClient to ask, built when a check runs, like every other model call.
export class PostingCheck
  {
    constructor({ clientFor, fetchPage, pageText = new PageText() })
      {
        this.clientFor = clientFor;
        this.fetchPage = fetchPage;
        this.pageText = pageText;
      }

    // { job: true } or { job: false, reason }. The second argument is the run's { log, budget, signal }, so the check is
    // billed to the run and stops with it.
    async check(link, { log, budget, signal } = {})
      {
        const ai = this.clientFor();
        const sample = await this.sampleOf(link, signal);
        const { message, tokens } = await ai.complete(this.messagesFor(link, sample), [], signal);
        await this.bill(ai.model, tokens, { log, budget });
        return this.verdictOf(message.content);
      }

    // Charged like any reply: to the run's budget, and on the run's record so the daily cap counts it.
    bill(model, tokens, { log, budget })
      {
        budget?.charge(model.costOf(tokens));
        return log?.addUsage(model, tokens);
      }

    // The start of the page as plain text on one line, or "" when it can't be read.
    async sampleOf(link, signal)
      {
        try
          {
            const page = await this.fetchPage(new URL(link), signal);
            const isHtml = !page.type || page.type.toLowerCase().includes("html");
            const text = isHtml ? this.pageText.from(page.html) : String(page.html || "");
            return text.replace(/\s+/g, " ").trim().slice(0, SAMPLE);
          }
        catch
          {
            return "";
          }
      }

    messagesFor(link, sample)
      {
        const task = sample.length >= THIN
          ? `Link: ${link}\n\nThe page's text (the start of it):\n${sample}`
          : `Link: ${link}\n\nThe page couldn't be read, so judge from the link alone. Answer "job" unless the link clearly isn't a job posting.`;
        return [{ role: "system", content: SYSTEM }, { role: "user", content: task }];
      }

    // Only a clear "not a job" refuses the link. Anything else, even a muddled answer, lets the run go on, since the
    // fill model still won't fill a card from a page that isn't a posting.
    verdictOf(content)
      {
        const answer = String(content || "").replace(/[*"]/g, "").trim();
        const refused = /^\W*not a job\b[\s:.,-]*(.*)$/is.exec(answer);
        if(!refused) return { job: true };
        return { job: false, reason: refused[1].split("\n")[0].trim().slice(0, 120) };
      }
  }
