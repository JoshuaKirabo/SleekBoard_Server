import { Deadline } from "./Deadline.js";
import { StreamedReply } from "./StreamedReply.js";

// How long a reply gets to finish once it has started. Every model we tried answered a whole test run in 1.5 to 12
// seconds.
const REPLY_MS = 45_000;

// Talks to one model. The OpenAI SDK gets handed in already pointed at Together, so tests can swap in a fake and
// another provider only means a different SDK client.
//
// Replies are streamed, the way claude-code-from-scratch does it. Some models only answer that way (Qwen3.8 Flash
// refuses anything else), and rebuilding the reply from its chunks gives every tool call a clean shape.
export class AiClient
  {
    constructor({ sdk, model, replyMs = REPLY_MS })
      {
        this.sdk = sdk;
        this.model = model;
        this.replyMs = replyMs;
      }

    // Asks the model once and hands back its reply plus the tokens it used. The signal lets the run's deadline cut off
    // a reply that's still on its way. The reply's own deadline does the same once it has taken too long.
    //
    // When a stream is cut off, the SDK just ends it, without an error, so what's been read so far looks like a whole
    // reply. Checking the signal afterwards turns that into the error it is, instead of handing back half a reply.
    async complete(messages, tools = [], signal)
      {
        const deadline = new Deadline(this.replyMs, "The model's reply");
        const stopped = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
        const stream = await this.open(messages, tools, stopped);
        const reply = await deadline.race(this.read(stream));
        stopped.throwIfAborted();
        return { message: reply.message(), tokens: reply.tokens() };
      }

    // Starts the reply. The SDK's timeout and retry only cover this part: its clock stops as soon as Together starts
    // answering, which for a stream is right away. No tools means a plain chat, so the tools field is left off instead
    // of sent empty, which some models refuse. A stream only reports its usage when asked to.
    open(messages, tools, signal)
      {
        const request = { model: this.model.id, messages, ...(tools.length && { tools }), stream: true, stream_options: { include_usage: true } };
        return this.sdk.chat.completions.create(request, { signal });
      }

    async read(stream)
      {
        const reply = new StreamedReply();
        for await (const chunk of stream) reply.add(chunk);
        return reply;
      }
  }
