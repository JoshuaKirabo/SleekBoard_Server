import { Deadline } from "./Deadline.js";

// How long one tool call gets before the model hears it timed out.
const TOOL_MS = 20_000;

// The tools one agent is allowed to use. A tool looks like { name, description, parameters, run }, where parameters
// is a JSON schema the model fills in and run(args, { signal, charge }) does the work. A tool should hand the signal
// to any fetch it makes, so a timed-out call actually stops, and a tool that costs money calls charge(dollars) so the
// run pays for it.
//
// A tool can also set perRun, the most times one run may call it. A new Toolbox is built for every run, so the count
// starts at 0 each time. It's checked in code rather than asked for in the prompt, because cheaper models don't
// reliably keep to a limit they're only told about.
export class Toolbox
  {
    constructor(tools = [], { toolMs = TOOL_MS } = {})
      {
        this.tools = new Map();
        this.used = new Map();
        this.toolMs = toolMs;
        tools.forEach((tool) => this.add(tool));
      }

    add(tool)
      {
        this.tools.set(tool.name, tool);
      }

    // What the model gets to see. It never sees run, just the name, what the tool's for and what to send.
    definitions()
      {
        return [...this.tools.values()].map(({ name, description, parameters }) => ({ type: "function", function: { name, description, parameters } }));
      }

    // Models sometimes make up a tool, or leave the name out, so both are errors the agent can read and get past.
    find(name)
      {
        if(!name) throw new Error("That tool call had no tool name.");
        const tool = this.tools.get(name);
        if(!tool) throw new Error(`There's no tool called "${name}".`);
        return tool;
      }

    // run is { signal, charge }: the run's deadline, and how a tool bills the run.
    async call(name, args, run = {})
      {
        const tool = this.find(name);
        this.use(tool);
        return this.timed(tool, args, run);
      }

    // Counts a call against the tool's perRun, and refuses it once the run has used them all. Every call that reaches
    // the tool counts, even one it turns down, so a model can't get past the limit by sending broken arguments.
    use(tool)
      {
        const used = this.used.get(tool.name) || 0;
        if(tool.perRun !== undefined && used >= tool.perRun) throw new Error(`You've used all ${tool.perRun} ${tool.name} calls for this run. Answer with what you have.`);
        this.used.set(tool.name, used + 1);
      }

    // Runs one tool against its own clock. The tool's signal flips when its time is up or when the whole run's is,
    // whichever comes first. The message says "The tool" instead of its name because the agent's log line already
    // starts with the name, and the model knows which call it was from the call's id.
    timed(tool, args, { signal: runSignal, charge })
      {
        const deadline = new Deadline(this.toolMs, "The tool");
        const signal = runSignal ? AbortSignal.any([deadline.signal, runSignal]) : deadline.signal;
        return deadline.race(Promise.resolve().then(() => tool.run(args, { signal, charge })));
      }
  }
