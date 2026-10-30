// The message list the model reads. It grows every turn, and the whole thing gets sent each time, which is why
// keeping big page text out of it matters.
export class Conversation
  {
    constructor(system)
      {
        this.list = [{ role: "system", content: system }];
      }

    addUser(text)
      {
        this.list.push({ role: "user", content: text });
      }

    // Keeping only what the next request needs. Extras some models send back (like their reasoning) get turned away
    // when we resend them.
    addReply(message)
      {
        const toolCalls = message.tool_calls || [];
        this.list.push({ role: "assistant", content: message.content || "", ...(toolCalls.length && { tool_calls: toolCalls }) });
      }

    // A tool's answer goes back as text, tied to the call that asked for it.
    addToolResult(callId, result)
      {
        const content = typeof result === "string" ? result : JSON.stringify(result);
        this.list.push({ role: "tool", tool_call_id: callId, content });
      }

    messages()
      {
        return this.list;
      }
  }
