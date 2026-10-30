// What a run or a tool gets when its time is up. It reads like any other error, so the model and the run log can
// show it as is.
export class DeadlineError extends Error
  {
    constructor(message)
      {
        super(message);
        this.name = "DeadlineError";
      }
  }

// A time limit on one piece of work. JavaScript can't force a promise to stop, so this does the two things it can:
// it stops waiting once time's up, and it flips its abort signal so work that listens (fetch, the OpenAI SDK) gives
// up too.
export class Deadline
  {
    constructor(ms, label)
      {
        this.ms = ms;
        this.label = label;
        this.controller = new AbortController();
      }

    get signal()
      {
        return this.controller.signal;
      }

    // Hands back whatever the work gives back, unless the clock runs out first. The clock starts here.
    race(work)
      {
        let timer;
        const expired = new Promise((_, reject) =>
          {
            timer = setTimeout(() =>
              {
                this.expire();
                reject(this.signal.reason);
              }, this.ms);
          });
        return Promise.race([work, expired]).finally(() => clearTimeout(timer));
      }

    // Tells anything holding the signal to stop, with the reason attached.
    expire()
      {
        this.controller.abort(new DeadlineError(`${this.label} took longer than ${this.length()}.`));
      }

    // "3 minutes" or "20 seconds", for the error message.
    length()
      {
        const seconds = Math.round(this.ms / 1000);
        if(seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? "" : "s"}`;
        return `${seconds} second${seconds === 1 ? "" : "s"}`;
      }
  }
