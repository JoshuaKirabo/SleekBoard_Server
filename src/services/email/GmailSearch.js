// The Gmail search that finds replies worth reading, ported from JobNavigator's email_monitor/gmail_client.py
// (_build_gmail_query) with the default lists from backend/seed.py, word for word. It reads job-site senders and
// job-ish subjects only, never the whole inbox.
//
// JobNavigator is MIT licensed: Copyright (c) 2026 JobNavigator Contributors.
// https://github.com/vesaias/JobNavigator/blob/main/backend/email_monitor/gmail_client.py

export const SENDERS =
  [
    "careers@", "jobs@", "recruiting@", "talent@", "no-reply@greenhouse.io", "no-reply@us.greenhouse-mail.io",
    "no-reply@ashbyhq.com", "notification@smartrecruiters.com", "@smartrecruiters.com", "@workablemail.com",
    "@hire.lever.co", "@myworkday.com", "@workdaymail.com", "@greenhouse.io", "@ashbyhq.com",
  ];

export const SUBJECTS =
  [
    "application", "thank you for applying", "thanks for applying", "application received", "application submitted",
    "your application", "interview", "assessment", "coding challenge", "take-home", "availability", "offer",
    "offer letter", "referral", "recruiter", "hiring team", "regret to inform", "not moving forward", "not selected",
    "application unsuccessful", "moving forward with other candidates", "unable to proceed", "position has been filled",
    "hiring freeze", "position on hold", "withdrawn",
  ];

export const EXCLUSIONS = ["newsletter", "webinar", "course", "discount", "event invitation", "job search council", "matched new opportunities"];

export class GmailSearch
  {
    constructor({ senders = SENDERS, subjects = SUBJECTS, exclusions = EXCLUSIONS } = {})
      {
        this.senders = senders;
        this.subjects = subjects;
        this.exclusions = exclusions;
      }

    // in:anywhere newer_than:3d ((from:… OR from:…) OR (subject:"…" OR …)) -subject:"…". in:anywhere is on purpose:
    // some job sites auto-archive their rejections, and JobNavigator found the API's spam-and-trash flag alone didn't
    // turn those up.
    query(days)
      {
        const parts = ["in:anywhere", `newer_than:${days}d`];
        const match = this.matchBlock();
        if(match) parts.push(match);
        const left = this.exclusions.map((term) => `-subject:"${term}"`).join(" ");
        if(left) parts.push(left);
        return parts.join(" ");
      }

    // The senders, the subjects, or either.
    matchBlock()
      {
        const from = this.senders.map((sender) => this.fromPart(sender)).join(" OR ");
        const subject = this.subjects.map((term) => `subject:"${term}"`).join(" OR ");
        if(from && subject) return `((${from}) OR (${subject}))`;
        if(from || subject) return `(${from || subject})`;
        return "";
      }

    // A domain ("@lever.co" or "lever.co") is from:@domain. Anything else, like "careers@", is quoted as typed.
    fromPart(sender)
      {
        const domain = sender.startsWith("@") || (sender.includes(".") && !sender.includes("@"));
        if(!domain) return `from:"${sender}"`;
        return `from:${sender.startsWith("@") ? sender : `@${sender}`}`;
      }
  }
