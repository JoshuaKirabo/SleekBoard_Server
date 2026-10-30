import { ReadPage } from "../tools/ReadPage.js";
import { SaveNotes } from "../tools/SaveNotes.js";
import { NOTE_PLAYBOOK } from "./notePlaybook.js";

// How each kind of contact reads in the brief.
const KIND_LABELS = { hiring_manager: "hiring_manager (leads the team)", recruiter: "recruiter", peer: "peer (on the team)", interviewer: "interviewer", internal_referral: "internal_referral (someone the user already knows)", other: "other" };

// One note-writing run for one contact and one job. Its tools are built here, fresh, like ContactRun's.
export class NoteRun
  {
    constructor({ job, contact, fetchPage })
      {
        this.job = job;
        this.contact = contact;
        this.save = new SaveNotes({ applied: this.applied() });
        this.toolList = [new ReadPage({ fetchPage }), this.save];
      }

    tools()
      {
        return this.toolList;
      }

    brief()
      {
        return { system: NOTE_PLAYBOOK, task: this.taskText() };
      }

    taskText()
      {
        const lines =
          [
            "Write the two notes.",
            `Company: ${this.job.company}`,
            `Role: ${this.job.role}`,
            `Location: ${this.job.location || "not saved"}`,
            `Posting: ${this.posting() || "none saved, so write from the role and company alone"}`,
            `Applied: ${this.applied() ? "yes" : "not yet"}`,
            `Person: ${this.contact.name}`,
            `Their title: ${this.contact.title || "not known"}`,
            `Who they are: ${KIND_LABELS[this.contact.type] || "other"}`,
            `How the user knows them: ${this.history()}`,
          ];
        return lines.join("\n");
      }

    // Anything past the saved lane means you've applied. Only then may a note say so.
    applied()
      {
        return this.job.status !== "saved";
      }

    posting()
      {
        const link = (this.job.link || "").trim();
        if(!link) return "";
        return link.includes("://") ? link : `https://${link}`;
      }

    // The facts about how you know them, and nothing more, so the note can't invent a history. Being saved for an
    // earlier application isn't a relationship (career-ops says the same); a LinkedIn connection is.
    history()
      {
        if(this.contact.source === "linkedin") return this.contact.connectedOn ? `connected on LinkedIn since ${this.contact.connectedOn}` : "connected on LinkedIn";
        return "they haven't been in touch yet";
      }

    // What the run saves: which contact, and the two notes. A run that ends without saving them failed.
    result()
      {
        if(!this.save.notes) throw new Error("The note writer finished without saving any notes.");
        return { contact: String(this.contact._id ?? this.contact.id), notes: this.save.notes };
      }
  }
