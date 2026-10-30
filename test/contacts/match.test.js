import { test } from "node:test";
import assert from "node:assert/strict";
import { CompanyMatch } from "../../src/services/contacts/CompanyMatch.js";
import { ConnectionsCsv } from "../../src/services/contacts/ConnectionsCsv.js";
import { ContactBook } from "../../src/services/contacts/ContactBook.js";

// The cases come from career-ops' own self-tests (linkedin-join.mjs and contact-lookup.mjs), so our port has to give
// the same answers theirs does.

const match = new CompanyMatch();
const tier = (a, b) => match.tier(match.tokensOf(a), match.tokensOf(b));

test("names typed differently still match exactly", () =>
  {
    assert.equal(tier("GE HealthCare", "GE Healthcare"), "exact");
    assert.equal(tier("Estée Lauder", "Estee Lauder"), "exact");
    assert.equal(tier("Crum & Forster", "Crum Forster"), "exact");
    assert.equal(tier("Société Générale", "Societe Generale"), "exact");
  });

test("letters that don't decompose still fold", () =>
  {
    assert.equal(tier("Ørsted", "Orsted"), "exact");
    assert.equal(tier("Işık Holding", "Isik Holding"), "exact");
    assert.equal(tier("Straße GmbH", "Strasse GmbH"), "exact");
    assert.equal(tier("Æther Labs", "Aether Labs"), "exact");
    assert.equal(tier("Łukasiewicz", "Lukasiewicz"), "exact");
  });

test("only filler words differ, so it's strong", () =>
  {
    assert.equal(tier("Crum & Forster", "Crum and Forster"), "strong");
    assert.equal(tier("EXL", "EXL Service Holdings, Inc."), "strong");
    assert.equal(tier("Siemens", "Siemens Digital Industries Software"), "strong");
    assert.equal(tier("New York Times", "The New York Times"), "strong");
  });

test("a different company is weak or no match, never strong", () =>
  {
    assert.equal(tier("Monogram Health", "Advocate Health"), null);
    assert.equal(tier("Loop", "Loopio"), null);
    assert.equal(tier("Datavant", "Snyk"), null);
    assert.equal(tier("Stealth Startup", "Acme Startup"), null);
    assert.equal(tier("GE", "GE Inc"), "weak");
    assert.equal(tier("Epic Systems", "Epic Games"), "weak");
    assert.equal(tier("Optimal Blue", "Blue Cloud Ventures"), "weak");
    assert.equal(tier("Red Cell Partners", "Red Rock Cell Co"), "weak");
    assert.equal(tier("Kixie Nimbus", "Nimbus Chainguard"), "weak");
  });

test("names in other scripts keep their letters and match themselves", () =>
  {
    assert.ok(match.tokensOf("株式会社テスト").key.length > 0);
    assert.ok(match.tokensOf("Яндекс").key.length > 0);
    assert.equal(tier("株式会社テスト", "株式会社テスト"), "exact");
  });

test("the 2nd-degree search link carries the company", () =>
  {
    assert.ok(match.secondDegreeSearch("Acme & Co").includes("keywords=Acme%20%26%20Co"));
  });

test("the CSV reader handles quotes, commas and line breaks", () =>
  {
    const rows = new ConnectionsCsv().rowsOf("a,\"b,c\",d\n\"line\nbreak\",\"say \"\"hi\"\"\",z\n");
    assert.equal(rows[0][1], "b,c");
    assert.equal(rows[1][0], "line\nbreak");
    assert.equal(rows[1][1], "say \"hi\"");
  });

test("a LinkedIn export is read past its notes, by column name", () =>
  {
    const csv = new ConnectionsCsv();
    const text =
      [
        "Notes:", "\"preamble text\"", "",
        "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
        "Jane,Doe,https://linkedin.com/in/janedoe,,Datavant,\"Director, Platform\",03 Aug 2026",
        "No,Employer,https://x,,,Consultant,01 Jan 2020",
        "Bad,Date,https://y,,Snyk,Engineer,31 Feb 2026",
      ].join("\n");
    const { connections, quality } = csv.parse(text);
    assert.equal(connections.length, 2);
    assert.deepEqual(connections[0], { name: "Jane Doe", company: "Datavant", title: "Director, Platform", linkedin: "https://linkedin.com/in/janedoe", email: "", connectedOn: "2026-08-03" });
    assert.equal(connections[1].connectedOn, "");
    assert.equal(quality.noCompany, 1);
    assert.equal(quality.unparsedDates, 1);
    assert.equal(csv.headerIndex(csv.rowsOf("x\ny\nz\nFirst Name,Company\nA,B\n")), 3);
    assert.equal(csv.parse("just,some\ncells,here").quality.noHeader, true);
  });

test("saved contacts key on name and company the way career-ops does", () =>
  {
    const book = new ContactBook({ Contact: null });
    assert.equal(book.keyOf("Jane Doe", "Datavant"), "janedoe::datavant");
    assert.equal(book.keyOf("Jane Doe", "ACME, Inc"), book.keyOf("jane doe", "Acme Inc."));
    assert.equal(book.keyOf("?", "?"), "::");
    assert.notEqual(book.keyOf("Jane", "Żubr"), book.keyOf("Jane", "Zubr"));
    assert.equal(book.companyKeyOf("ACME, Inc"), book.companyKeyOf("Acme Inc."));
    assert.equal(book.companyKeyOf("?"), "");
    assert.deepEqual(book.companyWordsOf("Stripe Inc."), ["stripe"]);
  });
