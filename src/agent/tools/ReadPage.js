import { PageText } from "./PageText.js";

// Longest page text the model gets back. Every page stays in the conversation and is re-sent on each later step, so
// this is what keeps a few reads from running up the bill.
const MAX_TEXT = 15_000;

// Longest link we'll try. Real ones are a few hundred characters at most.
const MAX_URL = 2_000;

// The read_page tool the model gets, ported from claude-code-from-scratch's web_fetch. It opens a link and hands back
// the page as plain text. Three things differ from theirs: the page comes through the link reader's fetchPage, which
// refuses links into our own network and checks every redirect; the text is cut at 15,000 characters, not a length
// the model picks; and PageText strips the tags without regexes that a crafted page could freeze.
//
// Reading a page is free, so it has no perRun, the same as in both reference repos. The run's budget still counts
// the tokens each page adds. seen, when given, is the run's SeenText, so a quote from this page can be checked later.
export class ReadPage
  {
    constructor({ fetchPage, maxText = MAX_TEXT, seen = null })
      {
        this.fetchPage = fetchPage;
        this.seen = seen;
        this.maxText = maxText;
        this.pageText = new PageText();
        this.name = "read_page";
        this.description = `Open a web page and get its text back, with the tags stripped. Long pages are cut off at ${maxText.toLocaleString("en-US")} characters.`;
        this.parameters = { type: "object", properties: { url: { type: "string", description: "The full link, starting with https://." } }, required: ["url"] };
      }

    async run(args, { signal } = {})
      {
        const url = this.urlFrom(args);
        const page = await this.fetchPage(url, signal);
        const text = this.trimmed(this.textOf(page));
        this.note(text, url, page.url);
        return text;
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
