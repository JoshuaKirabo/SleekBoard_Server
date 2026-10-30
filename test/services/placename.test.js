import { test } from "node:test";
import assert from "node:assert/strict";
import { PlaceName } from "../../src/services/PlaceName.js";

const places = new PlaceName();

test("Intel's Workday address comes out as City, ST", () =>
  {
    assert.equal(places.fromAddress({ locality: "USA - CA - Folsom", country: "United States of America" }), "Folsom, CA");
  });

test("country-first Workday lists turn around", () =>
  {
    assert.equal(places.fromAddress({ locality: "US, CA, Santa Clara" }), "Santa Clara, CA");
    assert.equal(places.fromAddress({ locality: "USA - TX - Austin" }), "Austin, TX");
  });

test("a state's full name becomes its code", () =>
  {
    assert.equal(places.format("San Francisco, California"), "San Francisco, CA");
    assert.equal(places.format("Kansas City, Missouri"), "Kansas City, MO");
    assert.equal(places.format("Washington, District of Columbia"), "Washington, DC");
    assert.equal(places.fromAddress({ locality: "Phoenix", region: "Arizona", country: "US" }), "Phoenix, AZ");
  });

test("places already in City, ST stay the same", () =>
  {
    assert.equal(places.format("New York, NY"), "New York, NY");
    assert.equal(places.fromAddress({ locality: "Folsom", region: "CA", country: "US" }), "Folsom, CA");
    assert.equal(places.fromAddress({ locality: "Folsom, CA", region: "California", country: "United States" }), "Folsom, CA");
  });

test("a city named like its state keeps both", () =>
  {
    assert.equal(places.format("New York, New York"), "New York, NY");
    assert.equal(places.format("Seattle, Washington"), "Seattle, WA");
  });

test("a trailing country and a county in the middle drop out", () =>
  {
    assert.equal(places.format("Folsom, CA, United States"), "Folsom, CA");
    assert.equal(places.format("Folsom, Sacramento County, California, U.S.A."), "Folsom, CA");
  });

test("places outside the US are kept as the site wrote them", () =>
  {
    assert.equal(places.fromAddress({ locality: "London", country: "United Kingdom" }), "London");
    assert.equal(places.format("Toronto, ON, CA"), "Toronto, ON, CA");
    assert.equal(places.fromAddress({ locality: "CA, ON, Toronto" }), "Toronto, ON");
    assert.equal(places.format("Tbilisi, Georgia"), "Tbilisi, Georgia");
    assert.equal(places.fromAddress({ locality: "Singapore, Singapore" }), "Singapore");
  });

test("Georgia the state still counts when the country says US", () =>
  {
    assert.equal(places.fromAddress({ locality: "Atlanta", region: "Georgia", country: "US" }), "Atlanta, GA");
  });

test("remote and empty places are left alone", () =>
  {
    assert.equal(places.format("Remote - US"), "Remote - US");
    assert.equal(places.format(""), "");
    assert.equal(places.fromAddress({}), "");
    assert.equal(places.fromAddress({ country: "United States" }), "United States");
    assert.equal(places.format(null), "");
  });

test("a US place with no state keeps its town", () =>
  {
    assert.equal(places.fromAddress({ locality: "Folsom", country: "USA" }), "Folsom");
  });

test("a long run of spaces doesn't slow it down", () =>
  {
    const started = performance.now();
    places.format(`Folsom,${" ".repeat(100_000)}x`);
    assert.ok(performance.now() - started < 50);
  });

test("an office list comes out as the first office and a count", () =>
  {
    assert.equal(places.offices("San Francisco, CA • New York, NY • United States"), "San Francisco, CA +2");
    assert.equal(places.offices("USA - CA - Folsom | USA - OR - Hillsboro"), "Folsom, CA +1");
    assert.equal(places.offices("Seattle, Washington"), "Seattle, WA");
    assert.equal(places.offices(""), "");
  });
