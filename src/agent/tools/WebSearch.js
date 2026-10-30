// Longest query we send. A real search is a few words, so anything past this is the model rambling.
const MAX_QUERY = 300;

// The web_search tool the model gets. It searches through ExaClient and hands the model back plain text: each
// result's title, link, date, the person's current job when Exa knows it, and the highlights Exa picked out.
//
// perRun is how many searches one run gets. 3 is career-ops' ceiling for finding a contact, which is the first task
// that will use it. A task that needs more can pass its own. seen, when given, is the run's SeenText: each result
// goes in under its own link, so suggest_contact can check a quote against the result it came from.
export class WebSearch
  {
    constructor({ exa, perRun = 3, seen = null })
      {
        this.exa = exa;
        this.perRun = perRun;
        this.seen = seen;
        this.name = "web_search";
        this.description = "Search the web. Each result comes back with its title, link and the most relevant passages from the page. LinkedIn profiles come back with the person's current job.";
        this.parameters = { type: "object", properties: { query: { type: "string", description: "What to search for, in a few words." } }, required: ["query"] };
      }

    // charge bills the search to the run, the same way a model reply is billed. It's charged before anything else,
    // because Exa has been paid even if the results come back empty.
    async run(args, { signal, charge } = {})
      {
        const query = this.queryFrom(args);
        const { results, cost } = await this.exa.search(query, signal);
        await charge?.(cost);
        if(!results.length) return `No results for "${query}".`;
        return results.map((result, index) => this.shown(result, index + 1)).join("\n\n");
      }

    // One result as the model will read it, noted down under its link first.
    shown(result, number)
      {
        const text = this.describe(result, number);
        this.seen?.add(result.url, text);
        return text;
      }

    // Checked here so a missing or empty query never becomes a paid search. Exa would refuse an empty one anyway.
    queryFrom(args)
      {
        const query = typeof args?.query === "string" ? args.query.trim() : "";
        if(!query) throw new Error("web_search needs a query, like {\"query\": \"Stripe technical recruiter\"}.");
        if(query.length > MAX_QUERY) throw new Error(`That query is ${query.length} characters. Keep it under ${MAX_QUERY}.`);
        return query;
      }

    // One result as a few lines of text. Lines Exa had nothing for are left out instead of printed empty.
    describe(result, number)
      {
        const lines = [`[${number}] ${this.clean(result.title) || "(no title)"}`, result.url, this.published(result), ...this.currentJobs(result), this.highlights(result)];
        return lines.filter(Boolean).join("\n");
      }

    published(result)
      {
        return result.publishedDate ? `Published ${result.publishedDate.slice(0, 10)}` : "";
      }

    // For a person, Exa sends their work history, and a job with no end date is the one they have now. That's
    // better proof than a profile headline, which people forget to update.
    currentJobs(result)
      {
        const people = (result.entities || []).filter((entity) => entity?.type === "person");
        const jobs = people.flatMap((person) => person.properties?.workHistory || []).filter((job) => job && !job.dates?.to);
        return jobs.map((job) => `Current job: ${job.title || "(no title)"} at ${job.company?.name || "(no company)"}${this.since(job)}`);
      }

    since(job)
      {
        return job.dates?.from ? `, since ${job.dates.from.slice(0, 7)}` : "";
      }

    highlights(result)
      {
        return (result.highlights || []).map((text) => this.clean(text)).filter(Boolean).join(" … ");
      }

    // Pages come back with line breaks and runs of spaces that cost tokens and say nothing.
    clean(text)
      {
        return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
      }
  }
