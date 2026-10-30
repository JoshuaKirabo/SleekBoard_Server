import { PageText } from "../../agent/tools/PageText.js";

// Turns one Gmail message into { id, from, subject, body }, ported from JobNavigator's email_monitor/gmail_client.py
// (the header loop in check_emails, _extract_body and _extract_mime). Plain text first, searching every nested part,
// and only when there's none, the HTML part turned into text. Theirs uses BeautifulSoup for that, ours PageText, the
// same reader the link reader uses.
//
// JobNavigator is MIT licensed: Copyright (c) 2026 JobNavigator Contributors.
// https://github.com/vesaias/JobNavigator/blob/main/backend/email_monitor/gmail_client.py
export class MailMessage
  {
    constructor({ pageText = new PageText() } = {})
      {
        this.pageText = pageText;
      }

    read(message)
      {
        const payload = message?.payload || {};
        return { id: message?.id, from: this.header(payload, "from"), subject: this.header(payload, "subject"), body: this.body(payload) };
      }

    // A header's value, or "" when the message hasn't got it. The last one wins, the same as theirs.
    header(payload, name)
      {
        const found = (payload.headers || []).filter((header) => String(header.name).toLowerCase() === name);
        return found.length ? String(found.at(-1).value || "") : "";
      }

    body(payload)
      {
        const plain = this.part(payload, "text/plain");
        if(plain) return plain;
        const html = this.part(payload, "text/html");
        return html ? this.pageText.from(html) : "";
      }

    // The first non-empty part of that type, looking at the payload itself, then its parts, then theirs.
    part(payload, type)
      {
        if(payload.mimeType === type && payload.body?.data) return this.decode(payload.body.data);
        for(const part of payload.parts || [])
          {
            const found = this.part(part, type);
            if(found) return found;
          }
        return "";
      }

    // Gmail sends bodies as URL-safe base64.
    decode(data)
      {
        return Buffer.from(String(data), "base64url").toString("utf8");
      }
  }
