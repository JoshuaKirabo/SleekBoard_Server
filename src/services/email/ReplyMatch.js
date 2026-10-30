import { TextKey } from "../contacts/TextKey.js";

// Tying a reply email to a job on the board, ported from JobNavigator's email_monitor/gmail_client.py
// (_extract_email_domain, _company_tokens, _email_matches_company and _match_email_to_application). The sender
// decides it, never the job title, so an Amazon "Product Manager" email can't land on a Kpler "Product Manager" card.
//
// One change from theirs: names and sender text go through our TextKey fold first, so "Nestlé Careers" still matches
// a card saying Nestle. Theirs splits on a-z and 0-9, which drops the é and breaks the word.
//
// JobNavigator is MIT licensed: Copyright (c) 2026 JobNavigator Contributors.
// https://github.com/vesaias/JobNavigator/blob/main/backend/email_monitor/gmail_client.py

// Legal suffixes and filler dropped from a company name, so "Kpler Technologies Inc." matches on "kpler". Their
// list, word for word. Shorter than CompanyMatch's on purpose: a sender saying "Data" or "Cloud" is still a signal.
const SUFFIXES = new Set(
  [
    "inc", "llc", "ltd", "limited", "gmbh", "ag", "sa", "plc", "co", "corp", "corporation", "company", "technologies",
    "technology", "labs", "group", "holdings", "international", "the",
  ]);

export class ReplyMatch
  {
    constructor({ keys = new TextKey() } = {})
      {
        this.keys = keys;
      }

    // The domain an email came from: "Kpler Talent <no-reply@greenhouse-mail.io>" is greenhouse-mail.io.
    domainOf(from)
      {
        const text = String(from || "");
        const address = text.includes("<") && text.includes(">") ? text.split("<")[1].split(">")[0] : text;
        const parts = address.split("@");
        return parts.length > 1 ? parts[1].toLowerCase() : "";
      }

    // The words that identify a company. Suffixes and anything under 3 letters go, unless that leaves nothing.
    wordsOf(company)
      {
        const all = this.fold(company).split(" ").filter(Boolean);
        const kept = all.filter((word) => !SUFFIXES.has(word) && word.length >= 3);
        return kept.length ? kept : all;
      }

    // Text folded to plain lowercase a-z and 0-9 words with single spaces.
    fold(text)
      {
        return this.keys.ascii(text);
      }

    // True when the company is named in the sender or subject, or (weaker) its full name is in the body.
    mentions(company, email)
      {
        if(!String(company || "").trim()) return false;
        if(this.inSender(company, email)) return true;
        return this.inBody(company, email);
      }

    // The strong match. A whole word in From or Subject, so "Box" doesn't hit "inbox". Or a 4+ letter word inside the
    // sender's domain with the dots and dashes taken out, so "kpler" hits mail.kpler-careers.com.
    inSender(company, email)
      {
        const sender = ` ${this.fold(`${email.from || ""} ${email.subject || ""}`)} `;
        const domain = this.domainOf(email.from).replace(/[^a-z0-9]/g, "");
        return this.wordsOf(company).some((word) => sender.includes(` ${word} `) || (word.length >= 4 && domain.includes(word)));
      }

    // The weak match: the full company name somewhere in the body.
    inBody(company, email)
      {
        const name = String(company || "").toLowerCase().trim();
        return Boolean(name) && String(email.body || "").toLowerCase().includes(name);
      }

    // The job this email is about, out of the jobs still waiting on a reply. A sender match wins outright. A body-only
    // match is held back until every job's been checked, in case a later one matches on the sender.
    jobFor(email, jobs)
      {
        let fallback = null;
        for(const job of jobs)
          {
            if(this.inSender(job.company, email)) return job;
            if(!fallback && this.inBody(job.company, email)) fallback = job;
          }
        return fallback;
      }
  }
