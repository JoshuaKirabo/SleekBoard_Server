// Turns a web page into the plain text the model reads, the same steps claude-code-from-scratch's web_fetch takes:
// drop scripts and styles, strip the tags, decode the common &codes;, and squash the spaces.
//
// It walks the page with indexOf instead of their regexes. The page is written by whoever owns the site, and on a
// crafted page those regexes take time that grows with the square of its size, which freezes the whole server (the
// security audit's medium finding on the link reader). Every step here reads the page once, start to end.

// Named codes worth decoding. Anything else is left as it was written.
const NAMED = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

// The quantifiers are bounded, so a long run of digits or letters can't make one match slow.
const ENTITY = /&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi;
const BLOCK = /<(script|style)\b/gi;

export class PageText
  {
    from(html)
      {
        return this.squashed(this.decoded(this.withoutTags(this.withoutBlocks(html))));
      }

    // Cuts out every <script> and <style> with what's inside it. One with no closing tag runs to the end of the
    // page, the way a browser reads it.
    withoutBlocks(html)
      {
        const lower = html.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
        const kept = [];
        let from = 0;
        BLOCK.lastIndex = 0;
        for(let found = BLOCK.exec(lower); found; found = BLOCK.exec(lower))
          {
            kept.push(html.slice(from, found.index));
            const close = lower.indexOf(`</${found[1].toLowerCase()}`, found.index);
            const end = close === -1 ? -1 : lower.indexOf(">", close);
            if(end === -1) return kept.join(" ");
            from = end + 1;
            BLOCK.lastIndex = from;
          }
        kept.push(html.slice(from));
        return kept.join(" ");
      }

    // Swaps each <tag> for a space. A < with no > anywhere after it isn't a tag, so the rest of the page stays as text.
    withoutTags(html)
      {
        const kept = [];
        let from = 0;
        for(let open = html.indexOf("<"); open !== -1; open = html.indexOf("<", from))
          {
            const close = html.indexOf(">", open);
            if(close === -1) break;
            kept.push(html.slice(from, open), " ");
            from = close + 1;
          }
        kept.push(html.slice(from));
        return kept.join("");
      }

    decoded(text)
      {
        return text.replace(ENTITY, (match, code) => this.character(code) ?? match);
      }

    // The character a code stands for, or undefined when it isn't one we know or isn't a real character.
    character(code)
      {
        if(code[0] !== "#") return NAMED[code.toLowerCase()];
        const point = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : undefined;
      }

    // Runs of spaces and blank lines cost tokens and say nothing.
    squashed(text)
      {
        return text.replace(/\s{2,}/g, " ").trim();
      }
  }
