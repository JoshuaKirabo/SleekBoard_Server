// The AI's read of a reply the phrase lists couldn't settle, ported from JobNavigator's email_monitor/response_parser.py
// (classify_email_llm) and the checks gmail_client.py runs on its answer. Same prompt, same system line, same 1,500
// characters of body, same 70 out of 100 to act. Their company check still runs on the job the AI picks, so it can't
// put an Amazon email on a Kpler card.
//
// It runs on the bottom rung like PostingCheck, and clientFor() builds the AiClient when a read starts.
//
// JobNavigator is MIT licensed: Copyright (c) 2026 JobNavigator Contributors.
// https://github.com/vesaias/JobNavigator/blob/main/backend/email_monitor/response_parser.py

const SYSTEM = "You classify recruiter emails and match them to job applications. Return only valid JSON.";

// Their editable prompt's default, word for word (backend/seed.py, email_llm_prompt).
const PROMPT = `Classify this email and match it to one active application if possible.

Rules:
- match_index: pick from the numbered applications below (1-based), or null if no match
- status: one of: interview, offer, rejected, no_change
- confidence: 0-100 how sure you are about classification AND match combined
- summary: one sentence describing what the email is about

Active applications:
{applications}

Email:
From: {from}
Subject: {subject}
Body:
{body}

Return ONLY this JSON:
{"match_index": null, "status": "no_change", "confidence": 0, "summary": ""}`;

const STATUSES = ["interview", "offer", "rejected", "no_change"];

// How much of the body the AI sees.
const BODY = 1_500;

// Below this the AI's answer is only logged, nothing moves. Their email_llm_confidence_threshold default.
const SURE = 70;

export class ReplyAi
  {
    constructor({ clientFor, match })
      {
        this.clientFor = clientFor;
        this.match = match;
      }

    // { job, status, confidence, summary }, or null when the AI's answer can't be used. job is one of the jobs handed
    // in, or null. The second argument is the caller's { log, budget, signal }, so the read is billed and stops with it.
    async read(email, jobs, { log, budget, signal } = {})
      {
        const ai = this.clientFor();
        const { message, tokens } = await ai.complete(this.messagesFor(email, jobs), [], signal);
        await this.bill(ai.model, tokens, { log, budget });
        return this.answerOf(message.content, jobs);
      }

    // Charged like any reply: to the budget, and on the record the daily cap counts.
    bill(model, tokens, { log, budget })
      {
        budget?.charge(model.costOf(tokens));
        return log?.addUsage(model, tokens);
      }

    // Every blank filled in one pass. Theirs fills them one after another, so a subject saying "{body}" got the body
    // pasted into it.
    messagesFor(email, jobs)
      {
        const values =
          {
            applications: this.listOf(jobs),
            from: email.from || "",
            subject: email.subject || "",
            body: String(email.body || "").slice(0, BODY),
          };
        const task = PROMPT.replace(/\{(applications|from|subject|body)\}/g, (_, blank) => values[blank]);
        return [{ role: "system", content: SYSTEM }, { role: "user", content: task }];
      }

    // The waiting jobs as a numbered list: "1. Kpler — Data Analyst (applied since 2026-10-01)".
    listOf(jobs)
      {
        if(!jobs.length) return "(no active applications)";
        return jobs.map((job, i) => `${i + 1}. ${job.company} — ${job.role} (${job.status} since ${job.applied || "unknown"})`).join("\n");
      }

    // The answer pulled out of the reply and checked. A bad status becomes no_change, a number off the list becomes no
    // job, and no usable confidence throws the whole answer away.
    answerOf(content, jobs)
      {
        const answer = this.jsonOf(content);
        if(!answer || typeof answer.confidence !== "number" || !Number.isFinite(answer.confidence)) return null;
        const status = STATUSES.includes(answer.status) ? answer.status : "no_change";
        const index = answer.match_index;
        const job = Number.isInteger(index) && index >= 1 && index <= jobs.length ? jobs[index - 1] : null;
        return { job, status, confidence: answer.confidence, summary: String(answer.summary || "") };
      }

    // The first flat {...} in the reply, so code fences and chatter around it don't matter. Failing that, the reply
    // with its fences stripped. null when neither parses.
    jsonOf(content)
      {
        const text = String(content || "").trim();
        const flat = /\{[^{}]*\}/s.exec(text);
        const candidate = flat ? flat[0] : text.replace(/^```\w*\n?/, "").split("```")[0].trim();
        try
          {
            const parsed = JSON.parse(candidate);
            return parsed && typeof parsed === "object" ? parsed : null;
          }
        catch
          {
            return null;
          }
      }

    // True when the answer is good enough to move a card: sure enough, a real change, a job picked, and that job's
    // company really is the sender. Fails the company check and nothing moves, however sure the AI is.
    acts(answer, email)
      {
        return this.usable(answer, email) && answer.confidence >= SURE;
      }

    // True when the answer passes everything but the 70: left on the card for you to say yes or no (Josh, 2026-10-30).
    suggests(answer, email)
      {
        return this.usable(answer, email) && answer.confidence < SURE;
      }

    // A real change, a job picked, and that job's company really is the sender. However sure the AI is, failing the
    // company check means nothing moves and nothing's suggested.
    usable(answer, email)
      {
        if(!answer || answer.status === "no_change" || !answer.job) return false;
        return this.match.mentions(answer.job.company, email);
      }
  }
