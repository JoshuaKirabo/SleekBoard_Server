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
        const toolCalls = (message.tool_calls || []).map((call) => this.cleanCall(call));
        this.list.push({ role: "assistant", content: message.content || "", ...(toolCalls.length && { tool_calls: toolCalls }) });
      }

    // A tool call the way it gets resent. Broken arguments are kept as {}, since GLM 5.3 Flash refuses the whole
    // request when a past call's arguments aren't valid JSON. The model still hears they were broken, from that call's
    // tool answer.
    cleanCall(call)
      {
        const args = call.function?.arguments;
        return { id: call.id, type: "function", function: { name: call.function?.name || "", arguments: this.isJson(args) ? args : "{}" } };
      }

    isJson(text)
      {
        if(typeof text !== "string") return false;
        try
          {
            JSON.parse(text);
            return true;
          }
        catch
          {
            return false;
          }
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
