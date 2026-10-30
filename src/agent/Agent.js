import { Conversation } from "./Conversation.js";

// Longest a step's text gets in the run log. Enough to read what happened, not a whole page.
const STEP_TEXT = 300;

// The loop: ask the model, run the tools it picked, hand the answers back, and go again until it answers without
// asking for a tool. Everything it needs gets handed in, so a test can give it a scripted fake model.
//
// signal belongs to the run's deadline. Once it flips, the loop stops before its next trip to the model, and the
// trip or tool already going gets told to stop too, so a timed-out run doesn't keep spending. budget is the run's
// RunBudget, and the loop stops the same way once it's used up.
export class Agent
  {
    constructor({ ai, toolbox, log, maxSteps = 12, signal, budget })
      {
        this.ai = ai;
        this.toolbox = toolbox;
        this.log = log;
        this.maxSteps = maxSteps;
        this.signal = signal;
        this.budget = budget;
      }

    // brief is { system, task }: the playbook and what to do this time. Gives back the model's final answer.
    async run({ system, task })
      {
        const conversation = new Conversation(system);
        conversation.addUser(task);

        for(let step = 0; step < this.maxSteps; step++)
          {
            this.signal?.throwIfAborted();
            this.budget?.ensureRoom();
            const reply = await this.ask(conversation);
            if(!reply.tool_calls?.length) return reply.content || "";
            await this.useTools(conversation, reply.tool_calls);
          }

        // Stopping here so a confused model can't loop and spend forever.
        throw new Error(`Gave up after ${this.maxSteps} steps without an answer.`);
      }

    // One trip to the model.
    async ask(conversation)
      {
        const reply = await this.ai.complete(conversation.messages(), this.toolbox.definitions(), this.signal);
        await this.record(conversation, reply);
        return reply.message;
      }

    // Writing the reply down: its tokens get billed to the run and charged to its budget, it joins the conversation,
    // and any words the model said on its way to a tool go in the log.
    async record(conversation, { message, tokens })
      {
        this.budget?.charge(this.ai.model.costOf(tokens));
        await this.log.addUsage(this.ai.model, tokens);
        conversation.addReply(message);
        if(message.content && message.tool_calls?.length) await this.log.addStep("message", message.content.slice(0, STEP_TEXT));
      }

    // Runs the tools one at a time, in the order the model asked, so the log reads in order.
    async useTools(conversation, toolCalls)
      {
        for(const call of toolCalls)
          {
            await this.log.addStep("tool", this.describe(call));
            conversation.addToolResult(call.id, await this.callTool(call));
          }
      }

    // A tool that breaks shouldn't end the run. The model gets the error back as its answer and can try something
    // else, and the log shows it.
    async callTool(call)
      {
        try
          {
            return await this.toolbox.call(call.function.name, this.readArgs(call), this.signal);
          }
        catch(error)
          {
            await this.log.addStep("error", `${call.function.name}: ${error.message}`.slice(0, STEP_TEXT));
            return `Error: ${error.message}`;
          }
      }

    // The model sends its arguments as a JSON string, and now and then it's broken JSON.
    readArgs(call)
      {
        try
          {
            return JSON.parse(call.function.arguments || "{}");
          }
        catch
          {
            throw new Error("Those arguments weren't valid JSON.");
          }
      }

    // How a tool call reads in the log, like web_search {"query":"EP recruiter"}.
    describe(call)
      {
        return `${call.function.name} ${call.function.arguments || ""}`.slice(0, STEP_TEXT);
      }
  }
