import readline from "node:readline";
import { Writable } from "node:stream";
import { Refusal } from "../../services/auth/PasswordReset.js";

// Questions and answers in the terminal, one line each. Immich asks through nest-commander's inquirer; this is plain
// node:readline so the script needs nothing new.
//
// A hidden answer isn't shown as it's typed. readline echoes every key through the stream it's handed, so that stream
// goes nowhere while a hidden question is open. Piped input (a script, a test) is never echoed at all.
export class Terminal
  {
    constructor({ input, output })
      {
        this.output = output;
        this.hidden = false;
        this.echoes = Boolean(input.isTTY);
        const echo = new Writable({ write: (chunk, encoding, done) => this.echo(chunk, done) });
        // No history, so a typed password isn't kept around for the up arrow.
        this.reader = readline.createInterface({ input, output: echo, terminal: this.echoes, historySize: 0 });
        // Read through one iterator from the start, so piped lines that come before their question wait instead of
        // getting dropped.
        this.lines = this.reader[Symbol.asyncIterator]();
      }

    echo(chunk, done)
      {
        if(!this.hidden) this.output.write(chunk);
        done();
      }

    say(text)
      {
        this.output.write(`${text}\n`);
      }

    async ask(question)
      {
        this.output.write(question);
        const answer = await this.next();
        if(!this.echoes) this.output.write("\n");
        return answer;
      }

    async askHidden(question)
      {
        this.output.write(question);
        this.hidden = true;
        try
          {
            return await this.next();
          }
        finally
          {
            this.hidden = false;
            this.output.write("\n");
          }
      }

    // The next line typed. Ctrl+C or Ctrl+D (or piped input running out) ends the input, which counts as giving up.
    async next()
      {
        const { value, done } = await this.lines.next();
        if(done) throw new Refusal("Stopped before every question was answered.");
        return value;
      }

    close()
      {
        this.reader.close();
      }
  }
