// Sorting a reply email with phrase lists before any AI sees it, ported from JobNavigator's
// email_monitor/response_parser.py (classify_email). Same lists, same order of rules, same confidence sums.
//
// JobNavigator is MIT licensed: Copyright (c) 2026 JobNavigator Contributors.
// https://github.com/vesaias/JobNavigator/blob/main/backend/email_monitor/response_parser.py

// Strong yes: scheduling, an invite, an offer. A "thanks for applying" email basically never says these.
const STRONG_YES =
  [
    "would like to schedule", "like to invite", "would like to invite", "schedule a call", "schedule an interview",
    "schedule a time", "set up a time", "set up a call", "availability for", "your availability",
    "preliminary phone screen", "phone screen", "pleased to inform",
  ];

// Weak yes: friendly filler that auto-replies use too ("we'll connect with you about next steps"), so it never
// counts as a yes on its own.
const WEAK_YES = ["next steps", "move forward", "we'd like to", "we would like to", "connect with you", "meet with", "excited to"];

const REJECTION =
  [
    "unfortunately", "not moving forward", "other candidates", "position has been filled", "decided not to",
    "not a match", "pursuing other", "regret to inform", "will not be moving", "after careful consideration",
    "competitive pool", "decided to go with", "not proceed", "no longer being considered",
  ];

const AUTO_REPLY =
  [
    "thank you for applying", "thanks for applying", "thank you for your application", "thanks for your application",
    "we received your application", "received your application", "application has been received",
    "thank you for your interest", "thanks for your interest", "confirming receipt", "application received",
    "auto-reply", "do not reply", "noreply", "no-reply",
  ];

// At or above this a positive or a rejection moves the card without asking the AI. Two phrases get there, one
// "unfortunately" (0.65) doesn't. JobNavigator's gmail_client.py uses the same 0.8.
const SURE = 0.8;

export class ReplySorter
  {
    // What the email is: "positive", "rejection", "auto_reply" or "ambiguous", with how sure the phrases are (0 to 1).
    sort(subject, body)
      {
        const text = `${subject || ""} ${body || ""}`.toLowerCase();
        return this.verdict(
          {
            strong: this.count(text, STRONG_YES),
            weak: this.count(text, WEAK_YES),
            rejection: this.count(text, REJECTION),
            autoReply: this.count(text, AUTO_REPLY),
          });
      }

    // How many phrases from one list show up in the text.
    count(text, phrases)
      {
        return phrases.filter((phrase) => text.includes(phrase)).length;
      }

    // Turning the counts into a verdict. Order matters, same as theirs.
    verdict({ strong, weak, rejection, autoReply })
      {
        // A rejection wins unless a strong yes is in there too, since rejections are full of "thank you for your interest".
        if(rejection > 0 && strong === 0) return { kind: "rejection", confidence: this.scale(rejection) };
        if(strong > 0 && rejection === 0) return { kind: "positive", confidence: this.scale(strong) };
        if(strong > 0 && rejection > 0) return { kind: "ambiguous", confidence: 0.4 };
        // No strong yes, so a "thanks for applying" is an auto-reply even with friendly filler in it.
        if(autoReply > 0) return { kind: "auto_reply", confidence: 0.9 };
        // Only filler. Too soft to act on, the AI decides.
        if(weak > 0) return { kind: "ambiguous", confidence: 0.35 };
        return { kind: "ambiguous", confidence: 0.2 };
      }

    // 0.5 plus 0.15 a phrase, never past 0.95.
    scale(hits)
      {
        return Math.min(0.5 + hits * 0.15, 0.95);
      }

    // True when the phrases alone are enough to move the card.
    sure({ kind, confidence })
      {
        return (kind === "positive" || kind === "rejection") && confidence >= SURE;
      }
  }
