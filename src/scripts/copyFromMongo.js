import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { prisma } from "../config/prisma.js";

// Copies everything in Mongo (Atlas) into Postgres, once, then checks every record came across the same.
//
//   npm run db:copy              copies, but only into an empty Postgres
//   npm run db:copy -- --fresh   empties SleekBoard's Postgres tables first, then copies
//
// Every record keeps its Mongo id as its Postgres id, so links between records, and ids saved inside a run's result,
// still point at the right thing. New records get uuids. Both are just text to the app.
//
// It all goes in one transaction: if anything fails, Postgres is left the way it was.
class MongoCopy
  {
    constructor(mongo, db)
      {
        this.mongo = mongo;
        this.db = db;
        this.source = {};
        this.notes = [];
      }

    async run(fresh)
      {
        await this.read();
        if(!fresh) await this.refuseIfFull();

        await this.db.$transaction(async (tx) =>
          {
            if(fresh) await this.empty(tx);
            await this.copyJobs(tx);
            await this.copyContacts(tx);
            await this.copyConnections(tx);
            await this.copyRuns(tx);
            await this.copyMailboxes(tx);
          }, { timeout: 120000 });

        const problems = await this.check();
        this.report(problems);
        return problems.length === 0;
      }

    // Raw documents straight off the collections, not through the models, so nothing gets filled in or dropped on
    // the way.
    async read()
      {
        for(const name of ["jobs", "contacts", "connections", "runs", "mailboxes"])
          this.source[name] = await this.mongo.collection(name).find().toArray();
        this.jobIds = new Set(this.source.jobs.map((job) => idOf(job)));
        this.contactIds = new Set(this.source.contacts.map((contact) => idOf(contact)));
      }

    async refuseIfFull()
      {
        const [jobs, contacts, runs] = await Promise.all([this.db.job.count(), this.db.contact.count(), this.db.run.count()]);
        if(jobs + contacts + runs > 0) throw new Error("Postgres already has data. Run with --fresh to empty it and copy again.");
      }

    // Deleting the parents takes the child tables (moves, steps, links) with them. It runs inside the copy's
    // transaction, so a copy that fails puts the old rows back too.
    async empty(tx)
      {
        await tx.run.deleteMany();
        await tx.contact.deleteMany();
        await tx.job.deleteMany();
        await tx.connection.deleteMany();
        await tx.mailbox.deleteMany();
      }

    async copyJobs(tx)
      {
        const jobs = this.source.jobs;
        await tx.job.createMany({ data: jobs.map((job) => jobRow(job)) });
        await tx.jobMove.createMany({ data: jobs.flatMap((job) => (job.moves || []).map((move) => moveRow(job, move))) });
        const suggested = jobs.filter((job) => job.replySuggestion);
        await tx.replySuggestion.createMany({ data: suggested.map((job) => suggestionRow(job)) });
      }

    async copyContacts(tx)
      {
        const contacts = this.source.contacts;
        await tx.contact.createMany({ data: contacts.map((contact) => contactRow(contact)) });
        await tx.contactJob.createMany({ data: contacts.flatMap((contact) => this.contactLinks(contact)) });
      }

    // A link to a job that's gone can't go in, since Postgres won't let a row point at nothing. Sorted so the check
    // can line them up with what Postgres sends back.
    contactLinks(contact)
      {
        const links = (contact.jobs || []).map((job) => ({ contactId: idOf(contact), jobId: String(job) })).sort((a, b) => a.jobId.localeCompare(b.jobId));
        const kept = links.filter((link) => this.jobIds.has(link.jobId));
        if(kept.length < links.length) this.notes.push(`${contact.name}: ${links.length - kept.length} link(s) to deleted jobs left out`);
        return kept;
      }

    async copyConnections(tx)
      {
        await tx.connection.createMany({ data: this.source.connections.map((connection) => connectionRow(connection)) });
      }

    async copyRuns(tx)
      {
        const runs = this.source.runs;
        await tx.run.createMany({ data: runs.map((run) => this.runRow(run)) });
        await tx.runStep.createMany({ data: runs.flatMap((run) => (run.steps || []).map((step) => stepRow(run, step))) });
        await tx.runUsage.createMany({ data: runs.flatMap((run) => (run.usage || []).map((usage) => usageRow(run, usage))) });
      }

    // Deleting a job used to leave its runs pointing at nothing. Here that becomes an empty job, which is what
    // deleting a job does from now on.
    runRow(run)
      {
        const jobId = run.job ? String(run.job) : null;
        const contactId = run.input?.contact ? String(run.input.contact) : null;
        const keepJob = jobId && this.jobIds.has(jobId);
        const keepContact = contactId && this.contactIds.has(contactId);
        if(jobId && !keepJob) this.notes.push(`run ${idOf(run)}: its job was deleted, so job is empty`);
        if(contactId && !keepContact) this.notes.push(`run ${idOf(run)}: its contact was deleted, so input contact is empty`);
        return { ...runFields(run), jobId: keepJob ? jobId : null, inputContactId: keepContact ? contactId : null };
      }

    async copyMailboxes(tx)
      {
        const mailboxes = this.source.mailboxes;
        await tx.mailbox.createMany({ data: mailboxes.map((mailbox) => mailboxRow(mailbox)) });
        await tx.mailboxResting.createMany({ data: mailboxes.flatMap((mailbox) => (mailbox.resting || []).map((rest) => restingRow(mailbox, rest))) });
      }

    // Reads everything back out of Postgres and compares it with Mongo, record by record and field by field.
    async check()
      {
        const problems = [];
        const compare = (label, rows, docs, toRow) =>
          {
            if(rows.length !== docs.length) problems.push(`${label}: ${docs.length} in Mongo, ${rows.length} in Postgres`);
            const byId = new Map(rows.map((row) => [row.id, row]));
            for(const doc of docs)
              {
                const row = byId.get(idOf(doc));
                if(!row)
                  {
                    problems.push(`${label} ${idOf(doc)}: missing`);
                    continue;
                  }
                const wanted = toRow(doc);
                for(const [field, value] of Object.entries(wanted))
                  if(!same(row[field], value)) problems.push(`${label} ${idOf(doc)}.${field}: ${show(value)} became ${show(row[field])}`);
              }
          };

        const order = { orderBy: { id: "asc" } };
        compare("job", await this.db.job.findMany({ include: { moves: order, replySuggestion: true } }), this.source.jobs, (job) => ({ ...jobRow(job), moves: (job.moves || []).map((move) => ({ ...moveRow(job, move) })), replySuggestion: job.replySuggestion ? suggestionRow(job) : null }));
        compare("contact", await this.db.contact.findMany({ include: { jobs: { orderBy: { jobId: "asc" } } } }), this.source.contacts, (contact) => ({ ...contactRow(contact), jobs: this.contactLinks(contact) }));
        compare("connection", await this.db.connection.findMany(), this.source.connections, (connection) => connectionRow(connection));
        compare("run", await this.db.run.findMany({ include: { steps: order, usage: order } }), this.source.runs, (run) => ({ ...this.runRow(run), steps: (run.steps || []).map((step) => stepRow(run, step)), usage: (run.usage || []).map((usage) => usageRow(run, usage)) }));
        compare("mailbox", await this.db.mailbox.findMany({ include: { resting: { orderBy: { at: "asc" } } } }), this.source.mailboxes, (mailbox) => ({ ...mailboxRow(mailbox), resting: (mailbox.resting || []).map((rest) => restingRow(mailbox, rest)) }));
        return problems;
      }

    report(problems)
      {
        const counts = Object.entries(this.source).map(([name, docs]) => `${docs.length} ${name}`).join(", ");
        console.log(`Copied ${counts}.`);
        for(const note of new Set(this.notes)) console.log(`  note: ${note}`);
        if(problems.length === 0) console.log("Checked every record field by field: all match.");
        for(const problem of problems) console.error(`  MISMATCH ${problem}`);
      }
  }

// Mongo document to Postgres row, one per table. Each only picks the fields the table has, so Mongo's __v stays
// behind.

const idOf = (doc) => String(doc._id);

const stamps = (doc) => ({ createdAt: doc.createdAt, updatedAt: doc.updatedAt });

const jobRow = (job) =>
  ({
    id: idOf(job),
    company: job.company,
    role: job.role,
    location: job.location ?? "",
    status: job.status ?? "saved",
    applied: job.applied ?? "",
    deadline: job.deadline ?? "",
    link: job.link ?? "",
    contact: job.contact ?? "",
    email: job.email ?? "",
    notes: job.notes ?? "",
    logo: job.logo ?? "",
    replyAt: job.replyAt ?? null,
    replySnippet: job.replySnippet ?? "",
    ...stamps(job),
  });

const moveRow = (job, move) => ({ jobId: idOf(job), from: move.from ?? null, to: move.to ?? null, at: move.at, source: move.source });

const suggestionRow = (job) =>
  ({
    jobId: idOf(job),
    to: job.replySuggestion.to,
    confidence: job.replySuggestion.confidence ?? null,
    at: job.replySuggestion.at,
  });

const contactRow = (contact) =>
  ({
    id: idOf(contact),
    key: contact.key,
    name: contact.name,
    company: contact.company,
    companyKey: contact.companyKey,
    companyWords: contact.companyWords ?? [],
    type: contact.type ?? "other",
    title: contact.title ?? "",
    location: contact.location ?? "",
    email: contact.email ?? "",
    link: contact.link ?? "",
    quote: contact.quote ?? "",
    reason: contact.reason ?? "",
    source: contact.source ?? "run",
    connectedOn: contact.connectedOn ?? "",
    ...stamps(contact),
  });

const connectionRow = (connection) =>
  ({
    id: idOf(connection),
    name: connection.name,
    company: connection.company,
    title: connection.title ?? "",
    linkedin: connection.linkedin ?? "",
    email: connection.email ?? "",
    connectedOn: connection.connectedOn ?? "",
    tokensAll: connection.tokens?.all ?? [],
    tokensDistinctive: connection.tokens?.distinctive ?? [],
    tokensKey: connection.tokens?.key ?? null,
    ...stamps(connection),
  });

// A run's result is free-form. Going through JSON turns Mongo ids and dates inside it into the same strings the API
// already sent the board.
const runFields = (run) =>
  ({
    id: idOf(run),
    kind: run.kind,
    status: run.status ?? "queued",
    cost: run.cost ?? 0,
    budget: run.budget ?? 0,
    inputLink: run.input?.link ?? null,
    result: run.result == null ? undefined : JSON.parse(JSON.stringify(run.result)),
    error: run.error ?? "",
    startedAt: run.startedAt ?? null,
    finishedAt: run.finishedAt ?? null,
    ...stamps(run),
  });

const stepRow = (run, step) => ({ runId: idOf(run), type: step.type, text: step.text ?? "", at: step.at });

const usageRow = (run, usage) =>
  ({
    runId: idOf(run),
    model: usage.model ?? "",
    tool: usage.tool ?? "",
    input: usage.input ?? 0,
    output: usage.output ?? 0,
    cost: usage.cost ?? 0,
  });

const mailboxRow = (mailbox) =>
  ({
    id: idOf(mailbox),
    key: mailbox.key,
    processed: mailbox.processed ?? [],
    caughtUp: mailbox.caughtUp ?? false,
    checkedAt: mailbox.checkedAt ?? null,
    login: mailbox.login ?? "",
    address: mailbox.address ?? "",
    connectedAt: mailbox.connectedAt ?? null,
    expired: mailbox.expired ?? "",
    ...stamps(mailbox),
  });

const restingRow = (mailbox, rest) => ({ mailboxId: idOf(mailbox), messageId: rest.id, at: rest.at });

// Equal the way the check needs: dates by their time, lists and objects by their contents (rows in a list matched on
// the fields we wrote, since Postgres adds its own ids), and Postgres' null the same as a result we left out.
const same = (actual, wanted) =>
  {
    if(wanted === undefined) return actual === null || actual === undefined;
    if(wanted instanceof Date) return actual instanceof Date && actual.getTime() === wanted.getTime();
    if(Array.isArray(wanted)) return Array.isArray(actual) && actual.length === wanted.length && wanted.every((item, i) => same(actual[i], item));
    if(wanted && typeof wanted === "object")
      {
        if(!actual || typeof actual !== "object") return false;
        return Object.keys(wanted).every((key) => same(actual[key], wanted[key]));
      }
    return actual === wanted;
  };

const show = (value) => JSON.stringify(value)?.slice(0, 80);

const fresh = process.argv.includes("--fresh");
await connectDB(process.env.MONGODB_URI || process.env.MONGO_URI);
try
  {
    const ok = await new MongoCopy(mongoose.connection.db, prisma).run(fresh);
    process.exitCode = ok ? 0 : 1;
  }
catch(error)
  {
    console.error(`Copy failed, Postgres left as it was: ${error.message}`);
    process.exitCode = 1;
  }
finally
  {
    await mongoose.disconnect();
    await prisma.$disconnect();
  }
