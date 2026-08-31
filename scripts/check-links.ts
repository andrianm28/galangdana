#!/usr/bin/env bun
/**
 * Crawls same-origin <a href> links starting from BASE_URL and fails if any
 * resolve to a non-2xx/3xx status. This exists because the platform this
 * project is modeled on ships a homepage link that 404s — see the spec's
 * Cross-cutting concerns section. Catch that class of bug in CI, not by hand.
 */
const BASE_URL = process.env.CHECK_LINKS_BASE_URL ?? "http://localhost:5173";
// Extra crawl entry points that aren't reachable by following <a href>
// links from "/" alone -- e.g. /search, which Task 13's search box submits
// as a <form>, not a same-origin <a href="/search">, so the crawler below
// would otherwise never visit it on its own.
const EXTRA_SEED_PATHS = (process.env.CHECK_LINKS_EXTRA_ROUTES ?? "").split(",").filter(Boolean);

async function crawl(): Promise<{ visited: number; broken: string[] }> {
  const seen = new Set<string>();
  const queue = ["/", ...EXTRA_SEED_PATHS];
  const broken: string[] = [];

  while (queue.length > 0) {
    const path = queue.shift();
    if (path === undefined || seen.has(path)) continue;
    seen.add(path);

    const url = new URL(path, BASE_URL).toString();
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      broken.push(`${path} -> ${response.status}`);
      continue;
    }

    const html = await response.text();
    for (const match of html.matchAll(/href="([^"]+)"/g)) {
      const href = match[1];
      if (!href || href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")) {
        continue;
      }
      if (!seen.has(href)) queue.push(href);
    }
  }

  return { visited: seen.size, broken };
}

const { visited, broken } = await crawl();
console.log(`Crawled ${visited} same-origin routes.`);
if (broken.length > 0) {
  console.error("Broken links found:");
  for (const b of broken) console.error(`  ${b}`);
  process.exit(1);
}
console.log("No broken links.");
