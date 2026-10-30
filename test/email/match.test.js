import { test } from "node:test";
import assert from "node:assert/strict";
import { ReplyMatch } from "../../src/services/email/ReplyMatch.js";

// Most cases are JobNavigator's own (backend/tests/test_gmail_client_match.py), so our port has to give the same
// answers theirs does. The sender decides the match, never the job title.

const match = new ReplyMatch();
const email = (from, subject, body = "") => ({ from, subject, body });
const job = (company, role = "Product Manager", status = "applied") => ({ company, role, status });

test("the company in the sender's domain matches", () =>
  {
    assert.equal(match.mentions("Amazon", email("Amazon.jobs <no-reply@amazon.com>", "Your application")), true);
  });

test("another company sharing the job title doesn't match", () =>
  {
    const amazon = email("Amazon.jobs <no-reply@amazon.com>", "Thanks for applying to the Product Manager role", "Thank you for applying to the Product Manager position at Amazon.");
    assert.equal(match.mentions("Kpler", amazon), false);
  });

test("the company in the sender's name matches, even from an ATS domain", () =>
  {
    assert.equal(match.mentions("Kpler", email("Kpler Talent <no-reply@greenhouse-mail.io>", "Update on your application")), true);
  });

test("the full company name in the body is a match when nothing else is", () =>
  {
    assert.equal(match.mentions("Kpler", email("no-reply@greenhouse-mail.io", "Application update", "We have received your application to Kpler.")), true);
  });

test("no company anywhere is no match", () =>
  {
    assert.equal(match.mentions("Kpler", email("no-reply@greenhouse-mail.io", "Application update", "Your application status has changed.")), false);
  });

test("a short company name doesn't match inside another word", () =>
  {
    assert.equal(match.mentions("Box", email("Amazon <no-reply@amazon.com>", "Check your inbox for next steps")), false);
  });

test("an Amazon email doesn't land on Kpler or DocuSign cards with the same title", () =>
  {
    const amazon = email("Amazon.jobs <no-reply@amazon.com>", "Thanks for applying to the Product Manager role", "Thank you for applying to the Product Manager position at Amazon.");
    assert.equal(match.jobFor(amazon, [job("Kpler"), job("DocuSign")]), null);
  });

test("the right company is picked out of several", () =>
  {
    const amazon = email("Amazon.jobs <no-reply@amazon.com>", "Your Amazon application", "Thank you for applying.");
    const found = match.jobFor(amazon, [job("Kpler"), job("Amazon", "Senior Product Manager - Tech, Prime Video Financial Systems")]);
    assert.equal(found.company, "Amazon");
  });

test("no card matches when the sender names no company", () =>
  {
    assert.equal(match.jobFor(email("no-reply@greenhouse-mail.io", "Application update", "Your application status has changed."), [job("Kpler")]), null);
  });

// Ours.

test("a sender match beats an earlier body-only match", () =>
  {
    const stripe = email("Stripe Recruiting <no-reply@stripe.com>", "Next steps", "Thanks for your time. Unlike Plaid, we move fast.");
    assert.equal(match.jobFor(stripe, [job("Plaid"), job("Stripe")]).company, "Stripe");
  });

test("legal suffixes on the card don't stop a match", () =>
  {
    assert.equal(match.mentions("Kpler Technologies Inc.", email("Kpler <jobs@kpler.com>", "Interview")), true);
  });

test("accents fold, so Nestlé matches Nestle", () =>
  {
    assert.equal(match.mentions("Nestle", email("Nestlé Careers <careers@nestle.com>", "Your application")), true);
    assert.equal(match.mentions("Nestlé", email("Nestle Careers <noreply@successfactors.com>", "Your application")), true);
  });

test("the domain is read out of the From line", () =>
  {
    assert.equal(match.domainOf("Kpler Talent <no-reply@Greenhouse-Mail.io>"), "greenhouse-mail.io");
    assert.equal(match.domainOf("jobs@stripe.com"), "stripe.com");
    assert.equal(match.domainOf("Nobody"), "");
  });

test("a card with no company never matches", () =>
  {
    assert.equal(match.mentions("", email("Amazon <no-reply@amazon.com>", "Interview")), false);
    assert.equal(match.jobFor(email("Amazon <no-reply@amazon.com>", "Interview"), [job("")]), null);
  });

test("two cards at one company: the role the email names wins, otherwise it's ambiguous", () =>
  {
    const swe = job("Figma", "Software Engineer");
    const pm = job("Figma", "Product Manager");
    const named = email("Figma <no-reply@figma.com>", "Your Product Manager application", "Thanks for applying.");
    const unnamed = email("Figma <no-reply@figma.com>", "Your application", "Thanks for applying.");
    assert.equal(match.jobFor(named, [swe, pm]), pm);
    assert.equal(match.ambiguous(named, [swe, pm]), false);
    assert.equal(match.jobFor(unnamed, [swe, pm]), null);
    assert.equal(match.ambiguous(unnamed, [swe, pm]), true);
  });

test("the sender's address is read out of the From line, lowercased", () =>
  {
    assert.equal(match.addressOf("Josh <JoshuaK2001@Gmail.com>"), "joshuak2001@gmail.com");
    assert.equal(match.addressOf("jobs@stripe.com"), "jobs@stripe.com");
  });
