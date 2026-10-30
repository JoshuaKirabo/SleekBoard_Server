import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Job } from "../models/job.model.js";

// Sample jobs for testing the board. Moved here from the client's src/data/jobs.js once the board started loading
// from Mongo.
//
//   npm run seed              adds them, but only when there are no jobs yet
//   npm run seed -- --reset   wipes every job first, real ones too, then adds them
const SAMPLES = [
  { company: "Stripe", role: "Frontend Engineer, Dashboard", location: "San Francisco, CA", status: "applied", applied: "2026-09-28", deadline: "2026-10-20", link: "stripe.com/jobs", contact: "Maya Chen", email: "maya@stripe.com", notes: "Referred by a friend on the Dashboard team. Portfolio link went in with the application." },
  { company: "Figma", role: "Product Engineer, New Grad", location: "New York, NY", status: "interviewing", applied: "2026-09-21", deadline: "2026-10-17", link: "figma.com/careers", contact: "Daniel Okoro", email: "daniel@figma.com", notes: "Phone screen went well. Onsite is a two-hour system design and a pairing session." },
  { company: "Shopify", role: "Software Engineer Intern", location: "Remote", status: "applied", applied: "2026-10-02", deadline: "2026-10-31", link: "shopify.com/careers", contact: "Recruiting team", email: "intern@shopify.com", notes: "" },
  { company: "Linear", role: "Design Engineer", location: "Remote", status: "saved", applied: "", deadline: "2026-10-24", link: "linear.app/careers", contact: "", email: "", notes: "Needs a short case study. Use the SleekBoard analytics page." },
  { company: "Datadog", role: "Software Engineer, Frontend", location: "Boston, MA", status: "interviewing", applied: "2026-09-15", deadline: "2026-10-15", link: "datadoghq.com/careers", contact: "Priya Nair", email: "priya.nair@datadoghq.com", notes: "Second round is a take-home. Due Friday." },
  { company: "Vercel", role: "Frontend Engineer", location: "Remote", status: "rejected", applied: "2026-09-10", deadline: "", link: "vercel.com/careers", contact: "Recruiting team", email: "jobs@vercel.com", notes: "Went with a more senior hire. Asked to reapply in six months." },
  { company: "Ramp", role: "Software Engineer, Product", location: "New York, NY", status: "offer", applied: "2026-09-08", deadline: "2026-10-18", link: "ramp.com/careers", contact: "Jordan Lee", email: "jordan@ramp.com", notes: "Offer letter in. Deciding by the 18th." },
  { company: "Atlassian", role: "Graduate Software Engineer", location: "Austin, TX", status: "applied", applied: "2026-10-05", deadline: "2026-11-01", link: "atlassian.com/careers", contact: "", email: "", notes: "" },
  { company: "Notion", role: "Software Engineer, Growth", location: "San Francisco, CA", status: "saved", applied: "", deadline: "2026-10-30", link: "notion.so/careers", contact: "", email: "", notes: "" },
  { company: "Airbnb", role: "Frontend Engineer, Trust", location: "Seattle, WA", status: "ghosted", applied: "2026-09-03", deadline: "", link: "careers.airbnb.com", contact: "Sam Walker", email: "sam.walker@airbnb.com", notes: "Two follow-ups, no reply since the phone screen." },
  { company: "Brex", role: "Software Engineer, Onboarding", location: "San Francisco, CA", status: "ghosted", applied: "2026-08-20", deadline: "", link: "brex.com/careers", contact: "", email: "", notes: "" },
  { company: "Cloudflare", role: "Systems Engineer Intern", location: "Austin, TX", status: "interviewing", applied: "2026-09-25", deadline: "2026-10-22", link: "cloudflare.com/careers", contact: "Elena Rossi", email: "elena@cloudflare.com", notes: "Recruiter call Tuesday 10am." },
];

const seed = async () =>
  {
    await connectDB(process.env.MONGODB_URI || process.env.MONGO_URI);

    if(process.argv.includes("--reset"))
      {
        const { deletedCount } = await Job.deleteMany({});
        console.log(`Wiped ${deletedCount} jobs.`);
      }
    else
      {
        const count = await Job.countDocuments();
        if(count > 0) return console.log(`There are already ${count} jobs, so nothing was added. Use --reset to start over.`);
      }

    // One at a time from the bottom up, so Stripe is the newest and the board's "most recent first" order matches
    // the list above.
    for(const sample of [...SAMPLES].reverse()) await Job.create(sample);
    console.log(`Added ${SAMPLES.length} sample jobs.`);
  };

try
  {
    await seed();
  }
catch(error)
  {
    console.error("Couldn't seed:", error.message);
    process.exitCode = 1;
  }
finally
  {
    await mongoose.disconnect();
  }
