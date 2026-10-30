// Puts one streamed reply back together. The model sends its words, its tool calls and its usage in small chunks,
// and this joins them into one message the way the non-streamed API would have sent it.
//
// Every tool call comes out in the same shape: { id, type: "function", function: { name, arguments } }, with
// arguments as text. A model that leaves a part out still gives a call of that shape, so nothing downstream trips over
// a missing field, and Together doesn't refuse the next request (it 400s on a call with no function part).
//
// On Together, all 8 models we tried send each call's id and name once, then its arguments in 2 to 6 pieces, each
// piece tagged with the call's index. Usage comes once, near the end.
export class StreamedReply
  {
    constructor()
      {
        this.content = "";
        this.calls = new Map();
        this.usage = null;
      }

    add(chunk)
      {
        if(chunk.usage) this.usage = chunk.usage;
        const delta = chunk.choices?.[0]?.delta;
        if(!delta) return;
        if(typeof delta.content === "string") this.content += delta.content;
        if(Array.isArray(delta.tool_calls)) delta.tool_calls.forEach((piece) => this.addPiece(piece));
      }

    // One piece of one tool call. The id and name come once, so the first one sent is kept. The arguments come in
    // bits and get joined.
    addPiece(piece)
      {
        const call = this.callFor(piece);
        if(!call.id && typeof piece.id === "string") call.id = piece.id;
        if(!call.name && typeof piece.function?.name === "string") call.name = piece.function.name;
        call.arguments += this.argumentsOf(piece);
      }

    // Finds the call a piece belongs to by its index. A piece with no index starts a new call when it carries an id,
    // and otherwise adds to the last one.
    callFor(piece)
      {
        const index = Number.isInteger(piece.index) ? piece.index : this.guessIndex(piece);
        if(!this.calls.has(index)) this.calls.set(index, { id: "", name: "", arguments: "" });
        return this.calls.get(index);
      }

    guessIndex(piece)
      {
        if(piece.id || !this.calls.size) return this.calls.size;
        return [...this.calls.keys()].at(-1);
      }

    // Arguments should be text. A model that sends an object gets it turned into text.
    argumentsOf(piece)
      {
        const args = piece.function?.arguments;
        if(typeof args === "string") return args;
        if(args && typeof args === "object") return JSON.stringify(args);
        return "";
      }

    // The finished message. A call with no id gets one, so its answer still has a call to point to.
    message()
      {
        const toolCalls = [...this.calls.entries()].sort(([a], [b]) => a - b).map(([index, call]) => this.shape(index, call));
        return { role: "assistant", content: this.content, ...(toolCalls.length && { tool_calls: toolCalls }) };
      }

    shape(index, { id, name, arguments: args })
      {
        return { id: id || `call_${index}`, type: "function", function: { name, arguments: args } };
      }

    tokens()
      {
        return { input: this.usage?.prompt_tokens || 0, output: this.usage?.completion_tokens || 0 };
      }
  }
