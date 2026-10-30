import { test } from "node:test";
import assert from "node:assert/strict";
import { GmailSearch } from "../../src/services/email/GmailSearch.js";
import { GmailApi, GmailError } from "../../src/services/email/GmailApi.js";
import { MailMessage } from "../../src/services/email/MailMessage.js";

const b64 = (text) => Buffer.from(text, "utf8").toString("base64url");

test("the search is JobNavigator's shape", () =>
  {
    const search = new GmailSearch({ senders: ["careers@", "@lever.co", "ashbyhq.com"], subjects: ["interview", "offer"], exclusions: ["webinar"] });
    assert.equal(search.query(3), 'in:anywhere newer_than:3d ((from:"careers@" OR from:@lever.co OR from:@ashbyhq.com) OR (subject:"interview" OR subject:"offer")) -subject:"webinar"');
  });

test("the search works with only senders, only subjects, or neither", () =>
  {
    assert.equal(new GmailSearch({ senders: ["@lever.co"], subjects: [], exclusions: [] }).query(90), "in:anywhere newer_than:90d (from:@lever.co)");
    assert.equal(new GmailSearch({ senders: [], subjects: ["offer"], exclusions: [] }).query(3), 'in:anywhere newer_than:3d (subject:"offer")');
    assert.equal(new GmailSearch({ senders: [], subjects: [], exclusions: [] }).query(3), "in:anywhere newer_than:3d");
  });

test("the default search has their lists", () =>
  {
    const query = new GmailSearch().query(3);
    assert.match(query, /from:"no-reply@greenhouse\.io"/);
    assert.match(query, /from:@hire\.lever\.co/);
    assert.match(query, /subject:"regret to inform"/);
    assert.match(query, /-subject:"matched new opportunities"$/);
  });

// A Gmail that answers from a list of pages and remembers what it was asked.
const gmailWith = (pages) =>
  {
    const asked = [];
    const fetch = async (url, options) =>
      {
        asked.push({ url: new URL(url), auth: options.headers.Authorization });
        const page = pages.shift();
        if(page instanceof Error) return { ok: false, status: page.status, text: async () => page.message };
        return { ok: true, status: 200, json: async () => page };
      };
    return { api: new GmailApi({ fetch }), asked };
  };

test("listing follows the page tokens, which theirs never did", async () =>
  {
    const { api, asked } = gmailWith([{ messages: [{ id: "a" }, { id: "b" }], nextPageToken: "p2" }, { messages: [{ id: "c" }] }]);
    assert.deepEqual(await api.ids("tok", "in:anywhere", { most: 10 }), ["a", "b", "c"]);
    assert.equal(asked.length, 2);
    assert.equal(asked[1].url.searchParams.get("pageToken"), "p2");
    assert.equal(asked[0].url.searchParams.get("includeSpamTrash"), "true");
    assert.equal(asked[0].auth, "Bearer tok");
  });

test("listing stops at the most it was asked for", async () =>
  {
    const { api, asked } = gmailWith([{ messages: [{ id: "a" }, { id: "b" }], nextPageToken: "p2" }, { messages: [{ id: "c" }] }]);
    assert.deepEqual(await api.ids("tok", "q", { most: 2 }), ["a", "b"]);
    assert.equal(asked.length, 1);
    assert.equal(asked[0].url.searchParams.get("maxResults"), "2");
  });

test("an empty inbox is no ids", async () =>
  {
    assert.deepEqual(await gmailWith([{ resultSizeEstimate: 0 }]).api.ids("tok", "q"), []);
  });

test("a Gmail error carries its status", async () =>
  {
    const { api } = gmailWith([Object.assign(new Error("invalid credentials"), { status: 401 })]);
    const error = await api.message("tok", "a").catch((caught) => caught);
    assert.ok(error instanceof GmailError);
    assert.equal(error.status, 401);
  });

test("a message reads its headers and its plain text, even nested", () =>
  {
    const message =
      {
        id: "m1",
        payload:
          {
            mimeType: "multipart/mixed",
            headers: [{ name: "From", value: "Kpler <no-reply@greenhouse-mail.io>" }, { name: "Subject", value: "Update" }],
            parts:
              [
                { mimeType: "multipart/alternative", parts: [{ mimeType: "text/html", body: { data: b64("<p>html</p>") } }, { mimeType: "text/plain", body: { data: b64("Unfortunately, no. Café") } }] },
              ],
          },
      };
    assert.deepEqual(new MailMessage().read(message), { id: "m1", from: "Kpler <no-reply@greenhouse-mail.io>", subject: "Update", body: "Unfortunately, no. Café" });
  });

test("with no plain text, the HTML is read as text", () =>
  {
    const message = { id: "m2", payload: { mimeType: "text/html", headers: [], body: { data: b64("<style>p{}</style><p>We&#39;d like to <b>schedule an interview</b></p>") } } };
    const mail = new MailMessage().read(message);
    assert.match(mail.body, /We'd like to schedule an interview/);
    assert.ok(!mail.body.includes("p{}"));
    assert.equal(mail.from, "");
  });

test("a message with no body is empty, not broken", () =>
  {
    assert.equal(new MailMessage().read({ id: "m3", payload: { headers: [] } }).body, "");
    assert.equal(new MailMessage().read({}).body, "");
  });
