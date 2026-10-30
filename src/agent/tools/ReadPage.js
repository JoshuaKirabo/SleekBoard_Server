import { PageText } from "./PageText.js";

// Longest page text the model gets back. Every page stays in the conversation and is re-sent on each later step, so
// this is what keeps a few reads from running up the bill.
const MAX_TEXT = 15_000;

// Longest link we'll try. Real ones are a few hundred characters at most.
const MAX_URL = 2_000;

// Page text shorter than this is a page that fills itself in with JavaScript, like Workday's, so Exa's copy is tried.
const THIN = 500;

// Sites that don't show servers the real page. LinkedIn sent ours a generic jobs search page instead of the posting
// (2026-10-30), which looks like a real page, so for these Exa's copy goes first.
const WALLED = ["linkedin.com", "glassdoor.com", "indeed.com"];

// The read_page tool the model gets, ported from claude-code-from-scratch's web_fetch. It opens a link and hands back
// the page as plain text. Three things differ from theirs: the page comes through the link reader's fetchPage, which
// refuses links into our own network and checks every redirect; the text is cut at 15,000 characters, not a length
// the model picks; and PageText strips the tags without regexes that a crafted page could freeze.
//
// Reading a page is free, so it has no perRun, the same as in both reference repos. The run's budget still counts
// the tokens each page adds. seen, when given, is the run's SeenText, so a quote from this page can be checked later.
//
// exa, when given, is the fallback for a page we can't open (LinkedIn turns servers away) or that comes back nearly
// empty because it's built with JavaScript (Workday): Exa's copy of the page is read instead, and charged to the run.
export class ReadPage
  {
    constructor({ fetchPage, maxText = MAX_TEXT, seen = null, exa = null })
      {
        this.fetchPage = fetchPage;
        this.seen = seen;
        this.exa = exa;
        this.maxText = maxText;
        this.pageText = new PageText();
        this.name = "read_page";
        this.description = `Open a web page and get its text back, with the tags stripped. Long pages are cut off at ${maxText.toLocaleString("en-US")} characters.`;
        this.parameters = { type: "object", properties: { url: { type: "string", description: "The full link, starting with https://." } }, required: ["url"] };
      }

    async run(args, { signal, charge } = {})
      {
        const url = this.urlFrom(args);
        const { text, landed } = await this.read(url, signal, charge);
        const shown = this.trimmed(text);
        this.note(shown, url, landed);
        return shown;
      }

    // Our own fetch first, since it's free. Exa's copy when ours fails or comes back thin, and ours otherwise. A walled
    // site goes to Exa first, since our fetch gets a stand-in page there.
    async read(url, signal, charge)
      {
        if(this.exa && this.isWalled(url))
          {
            const copy = await this.exaCopy(url, signal, charge);
            if(copy) return { text: copy, landed: null };
          }
        let page = null;
        let failure = null;
        try
          {
            page = await this.fetchPage(url, signal);
          }
        catch(error)
          {
            if(!this.exa || signal?.aborted) throw error;
            failure = error;
          }
        const text = page ? this.textOf(page) : "";
        if(!this.exa || text.length >= THIN) return { text, landed: page?.url };
        const copy = await this.exaCopy(url, signal, charge);
        if(copy) return { text: copy, landed: page?.url };
        if(failure) throw failure;
        return { text, landed: page?.url };
      }

    isWalled(url)
      {
        const host = url.hostname.toLowerCase();
        return WALLED.some((site) => host === site || host.endsWith(`.${site}`));
      }

    async exaCopy(url, signal, charge)
      {
        const { text, cost } = await this.exa.contents(url.href, signal);
        await charge?.(cost);
        return text.trim();
      }

    // Kept under the link the model asked for and the one it landed on after any redirects, since it may quote either.
    note(text, asked, landed)
      {
        this.seen?.add(asked.href, text);
        if(landed) this.seen?.add(String(landed), text);
      }

    // Checked here so a missing or broken link never reaches the network.
    urlFrom(args)
      {
        const link = typeof args?.url === "string" ? args.url.trim() : "";
        if(!link) throw new Error("read_page needs a url, like {\"url\": \"https://example.com/team\"}.");
        if(link.length > MAX_URL) throw new Error(`That link is ${link.length} characters. Keep it under ${MAX_URL}.`);
        try
          {
            return new URL(link);
          }
        catch
          {
            throw new Error("That isn't a full link. Start it with https://.");
          }
      }

    // HTML gets turned into text. Anything else, like JSON or plain text, is already readable and comes back as is.
    textOf(page)
      {
        const isHtml = !page.type || page.type.toLowerCase().includes("html");
        return isHtml ? this.pageText.from(page.html) : page.html.trim();
      }

    trimmed(text)
      {
        if(!text) return "(empty response)";
        if(text.length <= this.maxText) return text;
        return `${text.slice(0, this.maxText)}\n\n[... truncated at ${this.maxText} characters]`;
      }
  }
