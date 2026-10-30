// Lets one piece of work through at a time, in the order it arrived, like Java's synchronized block. It only holds
// inside this one server process, which is fine while there's exactly one.
export class Lock
  {
    constructor()
      {
        this.tail = Promise.resolve();
      }

    // Runs work once everything that came before it has finished, and gives back its result or its error. One
    // failure doesn't block the next in line.
    hold(work)
      {
        const turn = this.tail.then(() => work());
        this.tail = turn.catch(() => {});
        return turn;
      }
  }
