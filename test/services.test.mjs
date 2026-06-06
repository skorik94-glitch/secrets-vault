import { test } from "node:test";
import assert from "node:assert/strict";
import {
  domainOf,
  matchService,
  aggregateServices,
  crossReference,
} from "../src/services.mjs";

test("domainOf normalizes and strips www", () => {
  assert.equal(domainOf("https://www.supabase.com/dashboard"), "supabase.com");
  assert.equal(domainOf("https://app.supabase.com/x"), "app.supabase.com");
  assert.equal(domainOf("not a url"), null);
});

test("matchService matches exact and subdomains", () => {
  assert.equal(matchService("app.supabase.com").service, "supabase");
  assert.equal(matchService("console.aws.amazon.com").service, "aws");
  assert.equal(matchService("foo.github.com").service, "github");
  assert.equal(matchService("example.com"), null);
});

test("aggregateServices sums visits and tracks recency", () => {
  const visits = [
    { url: "https://app.supabase.com/a", visitCount: 3, lastVisit: 100, browser: "Chrome" },
    { url: "https://supabase.com/b", visitCount: 2, lastVisit: 500, browser: "Arc" },
    { url: "https://github.com/x", visitCount: 10, lastVisit: 200, browser: "Chrome" },
    { url: "https://example.com/none", visitCount: 99, lastVisit: 1, browser: "Chrome" },
  ];
  const agg = aggregateServices(visits);
  const sb = agg.find((s) => s.service === "supabase");
  assert.equal(sb.visits, 5);
  assert.equal(sb.lastVisit, 500);
  assert.deepEqual(sb.browsers.sort(), ["Arc", "Chrome"]);
  assert.equal(agg[0].service, "github"); // sorted by visits desc
  assert.equal(agg.find((s) => s.service === "example"), undefined); // uncatalogued dropped
});

test("crossReference splits both / gaps / orphans", () => {
  const fs = ["github", "aws", "generic", "cert"];
  const browser = [{ service: "github" }, { service: "supabase" }, { service: "vercel" }];
  const x = crossReference(fs, browser);
  assert.deepEqual(x.both, ["github"]);
  assert.deepEqual(x.gaps.map((g) => g.service).sort(), ["supabase", "vercel"]);
  assert.deepEqual(x.orphans, ["aws"]); // generic + cert excluded
});
