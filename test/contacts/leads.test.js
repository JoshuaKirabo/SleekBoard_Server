import { test } from "node:test";
import assert from "node:assert/strict";
import { WarmLeads } from "../../src/services/contacts/WarmLeads.js";
import { ContactBook } from "../../src/services/contacts/ContactBook.js";

// A ContactBook whose reads come from lists instead of Mongo.
const bookWith = ({ saved = [], atCompany = [] }) =>
  {
    const book = new ContactBook({ Contact: null });
    book.forJob = async () => saved;
    book.atCompany = async () => atCompany;
    return book;
  };

const connectionsWith = (list) => ({ matchesFor: async () => list, secondDegreeSearch: (company) => `search:${company}` });

test("a connection who's already a saved contact only shows once, as the contact", async () =>
  {
    const book = bookWith({ saved: [{ name: "Ana Lopez" }], atCompany: [{ name: "Ben Ng", match: "strong" }] });
    const connections = connectionsWith([{ name: "ana lopez", company: "Stripe" }, { name: "Ben Ng", company: "Stripe" }, { name: "Cy Ode", company: "Stripe" }]);
    const leads = new WarmLeads({ book, connections, card: null });
    const answer = await leads.forJob({ _id: "job-1", company: "Stripe Inc." });
    assert.deepEqual(answer.saved, [{ name: "Ana Lopez" }]);
    assert.deepEqual(answer.leads.contacts, [{ name: "Ben Ng", match: "strong" }]);
    assert.deepEqual(answer.leads.connections.map((connection) => connection.name), ["Cy Ode"]);
    assert.equal(answer.leads.secondDegreeSearch, "search:Stripe Inc.");
  });
