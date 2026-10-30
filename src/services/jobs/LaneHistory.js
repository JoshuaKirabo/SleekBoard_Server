// Moving a card between lanes and writing each move down, ported from JobNavigator's backend/models/db.py
// (record_transition and revert_transition) and the undo in api/routes_applications.py.
//
// Every write only lands if the card is still where we read it, so a drag and an email moving the same card at the
// same moment can't both land. A null back means it had already moved.
//
// JobNavigator is MIT licensed: Copyright (c) 2026 JobNavigator Contributors.
// https://github.com/vesaias/JobNavigator/blob/main/backend/models/db.py

export class LaneHistory
  {
    constructor({ Job })
      {
        this.Job = Job;
      }

    // Moves the card to lane `to` and adds the move to its history. `also` is anything else to save in the same write.
    // A reply suggestion goes stale once the card moves, whoever moved it, so it's cleared too. Moving to the lane it's
    // already in writes nothing.
    async move(job, to, source, also = {})
      {
        if(job.status === to) return job;
        const step = { from: job.status, to, at: new Date(), source };
        return this.Job.findOneAndUpdate(
          { _id: job._id, status: job.status },
          { $set: { status: to, replySuggestion: null, ...also }, $push: { moves: step } },
          { new: true, runValidators: true });
      }

    // The toast's Undo: puts the card back in `back` and takes the move off its history, so it never happened. Only when
    // the last move really was back → here. Anything else is a normal move from the board.
    async undo(job, back)
      {
        const moves = job.moves || [];
        const last = moves.at(-1);
        if(!last || last.to !== job.status || last.from !== back) return this.move(job, back, "board");
        return this.Job.findOneAndUpdate(
          { _id: job._id, status: job.status, moves: { $size: moves.length } },
          { $set: { status: back, replySuggestion: null }, $pop: { moves: 1 } },
          { new: true, runValidators: true });
      }
  }
