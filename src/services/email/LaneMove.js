// Which lane a reply moves a card to, ported from JobNavigator's email_monitor/gmail_client.py (_apply_email_to_app
// and _apply_llm_result_to_app). Cards only ever move forward.
//
// One change from theirs: they have no Ghosted lane. A reply on a Ghosted card means they weren't ghosting after all,
// so Ghosted is watched like Applied and sits at the same step (Josh, 2026-10-30).
//
// JobNavigator is MIT licensed: Copyright (c) 2026 JobNavigator Contributors.
// https://github.com/vesaias/JobNavigator/blob/main/backend/email_monitor/gmail_client.py

// The lanes still waiting on a reply. Saved hasn't been sent, and Offer and Rejected are done. Theirs is applied and
// interview, plus our Ghosted.
export const WAITING = ["applied", "interviewing", "ghosted"];

// How far along each lane is. Rejected sits past everything, so any waiting card can drop into it.
const STEP = { applied: 0, ghosted: 0, interviewing: 1, offer: 2, rejected: 99 };

// The AI answers in JobNavigator's words. These are our lanes for them.
const AI_LANES = { interview: "interviewing", offer: "offer", rejected: "rejected" };

export class LaneMove
  {
    // True when the card is in a lane that a reply can move.
    waiting(lane)
      {
        return WAITING.includes(lane);
      }

    // Where a card goes after the phrase lists sort its email, or null to leave it. A positive only moves a card that
    // hasn't been interviewed yet. A rejection ends any waiting card.
    afterPhrases(lane, kind)
      {
        if(!this.waiting(lane)) return null;
        if(kind === "positive") return lane === "applied" || lane === "ghosted" ? "interviewing" : null;
        if(kind === "rejection") return "rejected";
        return null;
      }

    // Where a card goes after the AI reads its email ("interview", "offer", "rejected" or "no_change"), or null to
    // leave it. Only further along, never back.
    afterAi(lane, status)
      {
        const next = AI_LANES[status];
        if(!next || !this.waiting(lane)) return null;
        return STEP[next] > STEP[lane] ? next : null;
      }
  }
