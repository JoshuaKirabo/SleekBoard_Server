// LinkedIn's limit on a connection note for a free account. career-ops measured it in LinkedIn's own compose box: 200
// on free, 300 on Premium, and it defaults to 200 so a note never gets cut off. AutoJob uses 200 too.
export const NOTE_CHARACTERS = 200;

// Two notes per person, and you pick one (AutoJob's idea, GPL, so our own code).
export const NOTE_STYLES = ["direct", "personal"];

// Tries, refused ones included, so a model that keeps writing 230 characters can't loop forever.
const TRIES = 4;

// A gap left for you to fill in, like "[your skill]". AutoJob refuses those, and so do we: a note goes out as written.
const PLACEHOLDER = /\[[^\]\n]{1,40}\]/;

// "I applied", "I've just applied", "I have already applied".
const APPLIED_CLAIM = /\bI(?:'ve| have)?\s+(?:just\s+|already\s+|recently\s+)?applied\b/i;

// The save_notes tool. The model hands over both notes and this checks them before keeping them. A note it refuses
// comes back to the model as an error it can fix.
export class SaveNotes
  {
    constructor({ applied })
      {
        this.applied = applied;
        this.notes = null;
        this.perRun = TRIES;
        this.name = "save_notes";
        this.description = `Save the two connection notes, one in each style, each at most ${NOTE_CHARACTERS} characters.`;
        this.parameters =
          {
            type: "object",
            properties:
              {
                direct: { type: "string", description: `Short and factual. At most ${NOTE_CHARACTERS} characters.` },
                personal: { type: "string", description: `Warm, opens with something specific, ends with a short question. At most ${NOTE_CHARACTERS} characters.` },
              },
            required: NOTE_STYLES,
          };
      }

    async run(args)
      {
        const notes = NOTE_STYLES.map((style) => ({ style, text: this.noteOf(args, style) }));
        this.ensureDifferent(notes);
        this.notes = notes;
        return "Saved both notes. Finish with one short sentence.";
      }

    // One note on one line, checked.
    noteOf(args, style)
      {
        const text = typeof args?.[style] === "string" ? args[style].replace(/\s+/g, " ").trim() : "";
        if(!text) throw new Error(`save_notes needs the ${style} note.`);
        if(text.length > NOTE_CHARACTERS) throw new Error(`The ${style} note is ${text.length} characters. Cut it to ${NOTE_CHARACTERS} or fewer.`);
        const placeholder = PLACEHOLDER.exec(text);
        if(placeholder) throw new Error(`The ${style} note has a placeholder, ${placeholder[0]}. Write it without one.`);
        if(!this.applied && APPLIED_CLAIM.test(text)) throw new Error(`The ${style} note says the user applied, but they haven't yet. Leave that out.`);
        return text;
      }

    ensureDifferent([first, second])
      {
        const plain = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
        if(plain(first.text) === plain(second.text)) throw new Error("The two notes are the same. Write them in different styles.");
      }
  }
