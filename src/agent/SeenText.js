// Every search result and page a tool showed the model during one run, kept by link. suggest_contact checks each
// contact against it, so a person the model made up, or a quote it wrote itself, never reaches the card. It's built
// fresh for every run, so one run can't quote another run's pages.
//
// This stands in for reopening the page (agreed with Josh, 2026-10-30): our server can't open LinkedIn, so a reopen
// would drop nearly every profile. It proves the words came from the web this run; it trusts Exa's copy of a profile.
//
// Each read of a link is kept as its own text, so a quote can't be stitched across two reads, and words only count
// as whole words, so "CA" isn't found inside "Chicago" (problem #30).
export class SeenText
  {
    constructor()
      {
        this.pages = new Map();
      }

    // Kept under the link the way the tool gave it, so the card gets that link and not the model's copy of it.
    add(link, text)
      {
        const url = this.urlOf(link);
        const flat = this.flatten(text);
        if(!url || !flat) return;
        const key = this.keyFor(url);
        const page = this.pages.get(key) || { link: url.href, texts: [] };
        page.texts.push(flat);
        this.pages.set(key, page);
      }

    has(link)
      {
        return this.pages.has(this.keyOf(link));
      }

    // The link a tool gave for this page, whichever way the model wrote it (problem #29).
    linkOf(link)
      {
        return this.pages.get(this.keyOf(link))?.link || "";
      }

    // True when the words appear, as whole words, in one read of that page.
    shows(link, words)
      {
        const flat = this.flatten(words);
        if(!flat) return false;
        return this.textsOf(link).some((text) => !this.places(text, flat).next().done);
      }

    // True when both appear in one read of the page within this many characters of each other, so a name and a quote
    // on a team page are about the same person.
    near(link, first, second, within)
      {
        const [a, b] = [this.flatten(first), this.flatten(second)];
        if(!a || !b) return false;
        return this.textsOf(link).some((text) => this.closeIn(text, a, b, within));
      }

    closeIn(text, a, b, within)
      {
        const seconds = [...this.places(text, b)];
        for(const at of this.places(text, a))
          {
            if(seconds.some((other) => Math.abs(other - at) <= within)) return true;
          }
        return false;
      }

    // A LinkedIn profile is about one person, so its name and quote can sit anywhere on it.
    isProfile(link)
      {
        return this.keyOf(link).startsWith("linkedin.com/in/");
      }

    // True when the link itself carries the words, like a search page's ?q=Jane+Doe. A page like that repeats what
    // it was asked for, so it can't prove anyone works anywhere.
    echoes(link, words)
      {
        const url = this.urlOf(link);
        const flat = this.flatten(words);
        if(!url || !flat) return false;
        return !this.places(this.flatten(this.decoded(url.search.replaceAll("+", " "))), flat).next().done;
      }

    textsOf(link)
      {
        return this.pages.get(this.keyOf(link))?.texts || [];
      }

    // Every place the words start in the text as whole words: the characters either side can't be a letter or digit.
    *places(text, words)
      {
        for(let at = text.indexOf(words); at !== -1; at = text.indexOf(words, at + 1))
          {
            if(this.isEdge(text[at - 1]) && this.isEdge(text[at + words.length])) yield at;
          }
      }

    isEdge(char)
      {
        return char === undefined || !/[\p{L}\p{N}]/u.test(char);
      }

    keyOf(link)
      {
        const url = this.urlOf(link);
        return url ? this.keyFor(url) : "";
      }

    // One page however the model writes its link: with or without https or www, a trailing slash, or a #part.
    // LinkedIn profiles also ignore case and anything after ?, and its country hosts (uk.linkedin.com) are the same
    // profile. Other sites keep both, since /People/Jane and ?id=2 can be different pages there.
    keyFor(url)
      {
        const host = this.hostOf(url);
        if(host === "linkedin.com") return `${host}${this.pathOf(url).toLowerCase()}`;
        return `${host}${this.pathOf(url)}${url.search}`;
      }

    // Only web links count. Anything else, like javascript: or data:, is no page at all (problem #29). A link typed
    // without its https:// still counts, the way people paste them.
    urlOf(link)
      {
        const text = typeof link === "string" ? link.trim() : "";
        if(!text) return null;
        try
          {
            const url = new URL(text.includes("://") ? text : `https://${text}`);
            return ["http:", "https:"].includes(url.protocol) && url.hostname ? url : null;
          }
        catch
          {
            return null;
          }
      }

    hostOf(url)
      {
        const host = url.hostname.toLowerCase();
        if(host === "linkedin.com" || host.endsWith(".linkedin.com")) return "linkedin.com";
        return host.startsWith("www.") ? host.slice(4) : host;
      }

    // Trailing slashes are cut with a loop, not a regex, the same care PageText takes with text from the web.
    pathOf(url)
      {
        let path = this.decoded(url.pathname);
        while(path.endsWith("/")) path = path.slice(0, -1);
        return path;
      }

    // linkedin.com/in/j%C3%B6rg and linkedin.com/in/jörg are the same page. A broken % code stays as it is.
    decoded(path)
      {
        try
          {
            return decodeURIComponent(path);
          }
        catch
          {
            return path;
          }
      }

    // Text the way it gets compared: one case, one kind of quote mark and dash, no Markdown marks, single spaces.
    // Every pattern here is a plain list of characters, so it runs in one pass however long the page is.
    flatten(text)
      {
        if(typeof text !== "string") return "";
        return text
          .normalize("NFKC")
          .toLowerCase()
          .replace(/[‘’‛′]/g, "'")
          .replace(/[“”‟″]/g, "\"")
          .replace(/[‐-―]/g, "-")
          // Bold and code marks wrap words, so they go without a trace ("**Jo**," is "jo,"). Headings, table bars and
          // quote marks sit between words, so they turn into a space.
          .replace(/[*_`]/g, "")
          .replace(/[#|>]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
  }
