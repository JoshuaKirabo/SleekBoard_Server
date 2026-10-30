import { test } from "node:test";
import assert from "node:assert/strict";
import { readUkg } from "../../src/services/jobReader.js";

// A UKG page the way it arrives: template code, then the job handed to the page's script as one JSON object.
const pageWith = (job) => `<html><body><div data-bind="text: Title"></div><script>
  var page = new US.Opportunity.CandidateOpportunityDetail(${JSON.stringify(job)});
</script></body></html>`;

const office = (City, Code) => ({ Address: { City, State: { Name: "", Code }, Country: { Name: "United States" } } });

const JOB =
  {
    Title: "Jr Software Developer",
    Locations: [office("Scottsdale", "AZ")],
    Description: "<p>About Us</p><p>Pinnacle Fertility is a leader in fertility care. Learn more at <a href=\"https://www.pinnaclefertility.com\" target=\"_blank\">www.pinnaclefertility.com</a>.</p>",
  };

test("a UKG posting gives its title, office, site and text", () =>
  {
    const found = readUkg(pageWith(JOB));
    assert.equal(found.role, "Jr Software Developer");
    assert.equal(found.location, "Scottsdale, AZ");
    assert.equal(found.website, "https://www.pinnaclefertility.com");
    assert.equal(found.company, "");
    assert.equal(found.source, "ukg");
    assert.match(found.about, /^About Us Pinnacle Fertility is a leader/);
    assert.doesNotMatch(found.about, /</);
  });

test("braces and escaped quotes inside the description don't cut the job short", () =>
  {
    const found = readUkg(pageWith({ ...JOB, Description: "<p>Use {curly} braces and \"quotes\" }} here.</p>", Locations: [office("Scottsdale", "AZ"), office("Austin", "TX")] }));
    assert.equal(found.location, "Scottsdale, AZ +1");
    assert.match(found.about, /\{curly\} braces and "quotes" \}\} here/);
  });

test("a page without UKG's job, or with it broken, reads as nothing", () =>
  {
    assert.equal(readUkg("<html><body>Just a page</body></html>"), null);
    assert.equal(readUkg("<script>CandidateOpportunityDetail({\"Title\": \"Cut off"), null);
    assert.equal(readUkg(pageWith({ Title: "" })), null);
  });

test("a long posting is held to about a page", () =>
  {
    const found = readUkg(pageWith({ ...JOB, Description: `<p>${"word ".repeat(5_000)}</p>` }));
    assert.ok(found.about.length <= 6_000);
  });
