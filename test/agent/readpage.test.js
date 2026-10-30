import { test } from "node:test";
import assert from "node:assert/strict";
import { ReadPage } from "../../src/agent/tools/ReadPage.js";
import { PageText } from "../../src/agent/tools/PageText.js";
import { Toolbox } from "../../src/agent/Toolbox.js";
import { Agent } from "../../src/agent/Agent.js";
import { fetchPage } from "../../src/services/jobReader.js";
import { ScriptedAi, MemoryLog, toolCall } from "../fakes.js";

// A fetchPage stand-in that hands back one page and remembers what it was asked for.
const pageOf = (html, type = "text/html; charset=utf-8") =>
  {
    const asked = [];
    const fetch = async (url, signal) =>
      {
        asked.push({ url: url.href, signal });
        return { html, url, type };
      };
    return { asked, tool: new ReadPage({ fetchPage: fetch }) };
  };

const read = (tool, url = "https://example.com/team") => tool.run({ url });

test("a page comes back as plain text: no scripts, styles or tags, codes decoded, spaces squashed", async () =>
  {
    const html = `<html><head><title>Team</title><style>body { color: red }</style><SCRIPT type="x">track("<b>")</SCRIPT></head>
      <body><h1>Our   team</h1>\n\n<p>Sam Rivera &amp; Ana Lopez &mdash; &#8220;hiring&#x201D;&nbsp;now</p></body></html>`;
    const { tool } = pageOf(html);
    assert.equal(await read(tool), "Team Our team Sam Rivera & Ana Lopez &mdash; “hiring” now");
  });

test("a script with no closing tag runs to the end, and a < with no > stays as text", () =>
  {
    const text = new PageText();
    assert.equal(text.from("<p>Hello</p><script>var a = 1; <p>never shown</p>"), "Hello");
    assert.equal(text.from("<p>3 < 5 and done"), "3 < 5 and done");
  });

test("codes that aren't real characters are left as written", () =>
  {
    assert.equal(new PageText().from("&#0; &#99999999; &#x110000; &bogus;"), "&#0; &#99999999; &#x110000; &bogus;");
  });

test("a long page is cut at 15,000 characters with a note, and an empty one says so", async () =>
  {
    const { tool } = pageOf(`<p>${"a".repeat(20_000)}</p>`);
    const text = await read(tool);
    assert.equal(text, `${"a".repeat(15_000)}\n\n[... truncated at 15000 characters]`);

    assert.equal(await read(pageOf(`<p>${"a".repeat(15_000)}</p>`).tool), "a".repeat(15_000));
    assert.equal(await read(pageOf("<html><script>x()</script></html>").tool), "(empty response)");
  });

test("JSON and plain text come back as they are", async () =>
  {
    const json = "{\"name\": \"<b>Sam</b>\"}";
    assert.equal(await read(pageOf(json, "application/json").tool), json);
  });

test("a missing, long or broken link is refused before anything is fetched", async () =>
  {
    const { asked, tool } = pageOf("<p>hi</p>");
    await assert.rejects(tool.run({}), /needs a url/);
    await assert.rejects(tool.run({ url: "  " }), /needs a url/);
    await assert.rejects(tool.run({ url: `https://example.com/${"a".repeat(2_000)}` }), /Keep it under 2000/);
    await assert.rejects(tool.run({ url: "example.com/team" }), /isn't a full link/);
    assert.equal(asked.length, 0);
  });

test("the tool's signal goes to the fetch, so a page stops loading when time's up", async () =>
  {
    const { asked, tool } = pageOf("<p>hi</p>");
    const signal = new AbortController().signal;
    await tool.run({ url: "https://example.com" }, { signal });
    assert.equal(asked[0].signal, signal);
  });

// The real fetchPage, which refuses links into our own network before connecting.
test("links into our own network, or that aren't web links, are refused", async () =>
  {
    const tool = new ReadPage({ fetchPage });
    for(const url of ["http://127.0.0.1:5050/api/jobs", "http://169.254.169.254/latest/meta-data", "http://10.0.0.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/"])
      {
        await assert.rejects(tool.run({ url }), /points somewhere we can't read/, url);
      }
    await assert.rejects(tool.run({ url: "file:///etc/passwd" }), /Only web links/);
  });

test("an already-stopped signal stops the fetch", async () =>
  {
    const tool = new ReadPage({ fetchPage });
    await assert.rejects(tool.run({ url: "https://example.com" }, { signal: AbortSignal.abort() }), /took too long/);
  });

// The security audit froze the link reader with pages like these. Each is about 3 MB, the most fetchPage reads.
test("pages built to freeze a regex are read in well under a second", () =>
  {
    const size = 3 * 1024 * 1024;
    const fill = (piece) => piece.repeat(Math.ceil(size / piece.length)).slice(0, size);
    const text = new PageText();
    for(const html of [fill("<"), fill("<script"), fill("<script>a</scrip"), fill("<style"), fill("&#x1"), fill("&amp"), fill(" \n"), fill("<a ")])
      {
        const started = performance.now();
        text.from(html);
        const took = performance.now() - started;
        assert.ok(took < 1_000, `${html.slice(0, 10)}… took ${Math.round(took)} ms`);
      }
  });

test("in a run, the page's text goes back to the model tied to its call", async () =>
  {
    const { tool } = pageOf("<h1>Team</h1><p>Sam Rivera, Engineering Manager</p>");
    const ai = new ScriptedAi(
      [
        { role: "assistant", content: "", tool_calls: [toolCall("c1", "read_page", { url: "https://linear.app/about" })] },
        { role: "assistant", content: "Sam Rivera." },
      ]);
    const log = new MemoryLog();
    const agent = new Agent({ ai, toolbox: new Toolbox([tool]), log, maxSteps: 3 });

    assert.equal(await agent.run({ system: "s", task: "t" }), "Sam Rivera.");
    const answer = ai.calls[1].messages.at(-1);
    assert.equal(answer.tool_call_id, "c1");
    assert.equal(answer.content, "Team Sam Rivera, Engineering Manager");
    assert.equal(log.steps[0].text, "read_page {\"url\":\"https://linear.app/about\"}");
  });
