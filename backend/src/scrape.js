/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  Multi-Board Job Scraper Engine — AU Wide Search                     ║
 * ║  Sources: Indeed, LinkedIn, Glassdoor, Google Jobs                  ║
 * ║                                                                     ║
 * ║  1. Searches across LinkedIn, Indeed, Glassdoor & Google            ║
 * ║  2. Country: Australia (country_indeed: 'Australia')                ║
 * ║  3. Priorities: Technology One Consultant, Data Analyst, Node, Next ║
 * ║  4. PROXY_URL support for IP ban protection                           ║
 * ║  5. REGEX FILTER: Drops 'Australian Citizen' & 'Permanent Resident'  ║
 * ║  6. Upserts surviving records to PostgreSQL via Prisma              ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 *  Usage: node src/scrape.js
 */

require("dotenv").config();
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const prisma = require("./db");
const path = require("path");
const fs = require("fs");

puppeteer.use(StealthPlugin());

// ── Configuration Settings ────────────────────────────────────────────
const COUNTRY_INDEED = "Australia";
const PROXY_URL = process.env.PROXY_URL || null;

// ── Search Targets & Platforms ────────────────────────────────────────
const SEARCH_QUERIES = [
  "Technology One Consultant",
  "Data Analyst",
  "Node.js",
  "Next.js",
];

const PLATFORMS = [
  {
    name: "Indeed",
    baseUrl: "https://au.indeed.com",
    buildUrl: (query, location) =>
      `https://au.indeed.com/jobs?q=${encodeURIComponent(query)}&l=${encodeURIComponent(location)}`,
  },
  {
    name: "LinkedIn",
    baseUrl: "https://au.linkedin.com",
    buildUrl: (query, location) =>
      `https://au.linkedin.com/jobs/search?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}`,
  },
  {
    name: "Google",
    baseUrl: "https://www.google.com",
    buildUrl: (query, location) =>
      `https://www.google.com/search?q=${encodeURIComponent(query + " jobs " + location + " Australia")}&ibp=htl;jobs`,
  },
  {
    name: "Glassdoor",
    baseUrl: "https://www.glassdoor.com.au",
    buildUrl: (query, location) =>
      `https://www.glassdoor.com.au/Job/australia-${encodeURIComponent(query.toLowerCase().replace(/\s+/g, "-"))}-jobs-SRCH_IL.0,9_IN16_KO10,${10 + query.length}.htm`,
  },
];

// ── Regex Filter for Disqualifying Terms ──────────────────────────────
const CITIZENSHIP_PR_DISQUALIFY_REGEX =
  /\b(australian citizen|australian citizenship|permanent resident|permanent residency|pr holder|citizenship required|must be an australian citizen|must be a permanent resident)\b/i;

// Priority scoring keywords
const HIGH_PRIORITY_KEYWORDS = [
  "node.js", "nodejs", "next.js", "nextjs", "react", "typescript",
  "python", "sql", "tableau", "data analyst", "full stack", "ai", "machine learning",
];

/** Random delay helper to prevent IP bans */
function randomDelay(min = 1500, max = 3500) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((r) => setTimeout(r, ms));
}

/** Calculate priority score — giving top priority to 'Technology One Consultant' */
function calculatePriorityScore(title, description, query) {
  let score = 50; // base score
  const text = `${title} ${description}`.toLowerCase();

  // Top Priority Boost for Technology One Consultant
  if (text.includes("technology one") || text.includes("technologyone") || query.toLowerCase().includes("technology one")) {
    score += 50;
  }

  HIGH_PRIORITY_KEYWORDS.forEach((kw) => {
    if (text.includes(kw)) score += 10;
  });

  if (text.includes("junior") || text.includes("graduate") || text.includes("mid")) score += 15;
  if (text.includes("senior") || text.includes("lead")) score -= 5;

  return Math.min(Math.max(score, 0), 100);
}

/** Generic scraper for search result cards across platforms */
async function scrapeListingsFromPage(page, platformName, baseUrl) {
  return page.evaluate(
    (plat, base) => {
      const results = [];
      const seen = new Set();

      let cards = [];
      const p = plat.toLowerCase();
      if (p === "indeed") {
        cards = Array.from(document.querySelectorAll(".job_seen_beacon, .resultContent, [data-jk]"));
      } else if (p === "linkedin") {
        cards = Array.from(document.querySelectorAll(".job-search-card, .base-card, .jobs-search-results__list-item"));
      } else if (p === "google") {
        cards = Array.from(document.querySelectorAll("[data-encoded-doc-id], .iKj2z, .PcfL2d"));
      } else {
        cards = Array.from(document.querySelectorAll("[data-test='jobListing'], .JobCard_jobCard___M_D, .job-tile"));
      }

      cards.forEach((card) => {
        try {
          const titleEl =
            card.querySelector("h2.jobTitle a, h2 a, a.job-card-list__title, [class*='title'] a, a[data-jk], h3") ||
            card.querySelector("a");

          const companyEl =
            card.querySelector("[data-testid='company-name'], .companyName, .job-card-container__company-name, [class*='company']");

          if (!titleEl) return;

          const title = titleEl.innerText.trim();
          let href = titleEl.getAttribute("href") || "";
          if (href && !href.startsWith("http")) {
            href = `${base}${href}`;
          }
          const fullUrl = href || `${base}/job-link-${Math.random()}`;
          const company = companyEl ? companyEl.innerText.trim() : "Company";

          if (title && title.length > 2 && !seen.has(fullUrl)) {
            seen.add(fullUrl);
            results.push({ title, company, url: fullUrl });
          }
        } catch (_) {}
      });

      return results;
    },
    platformName,
    baseUrl
  );
}

/** Extract full description from detail page */
async function fetchJobDescription(page, url) {
  try {
    if (!url.startsWith("http")) return "Detailed description available on job board.";
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await randomDelay(1000, 2000);

    const description = await page.evaluate(() => {
      const el =
        document.querySelector("#jobDescriptionText") ||
        document.querySelector("[class*='description']") ||
        document.querySelector(".show-more-less-html__markup") ||
        document.querySelector(".jobsearch-jobDescriptionText");
      return el ? el.innerText.trim() : "";
    });

    return description || "Detailed description available on job board.";
  } catch (_) {
    return "Detailed description available on job board.";
  }
}

// ── Main Execution ────────────────────────────────────────────────────
async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  Multi-Board Job Scraper Engine — Australia               ║");
  console.log(`║  Country: ${COUNTRY_INDEED.padEnd(20)} Proxy: ${(PROXY_URL ? "ENABLED" : "DISABLED").padEnd(17)}║`);
  console.log("║  Platforms: Indeed, LinkedIn, Glassdoor, Google Jobs     ║");
  console.log("║  Regex Filter: Dropping Citizen / PR Restrictions        ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  await prisma.$connect();
  console.log("✅ Database connected");

  // Configure Puppeteer args with proxy if configured
  const puppeteerArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--window-size=1920,1080",
  ];

  let proxyAuth = null;
  if (PROXY_URL) {
    console.log(`📡 Using PROXY_URL: ${PROXY_URL.replace(/:[^:@]+@/, ":***@")}`);
    try {
      const parsed = new URL(PROXY_URL);
      if (parsed.username && parsed.password) {
        proxyAuth = { username: parsed.username, password: parsed.password };
        puppeteerArgs.push(`--proxy-server=${parsed.protocol}//${parsed.host}`);
      } else {
        puppeteerArgs.push(`--proxy-server=${PROXY_URL}`);
      }
    } catch (_) {
      puppeteerArgs.push(`--proxy-server=${PROXY_URL}`);
    }
  }

  const browser = await puppeteer.launch({
    headless: "new",
    args: puppeteerArgs,
    defaultViewport: { width: 1920, height: 1080 },
  });

  const page = await browser.newPage();
  if (proxyAuth) {
    await page.authenticate(proxyAuth);
  }
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  );

  let totalScraped = 0;
  let totalDropped = 0;
  let totalSaved = 0;

  for (const query of SEARCH_QUERIES) {
    for (const platform of PLATFORMS) {
      const location = "Sydney NSW";
      console.log(`\n🔍 Searching [${platform.name.toUpperCase()}]: "${query}" in Australia`);
      const searchUrl = platform.buildUrl(query, location);
      console.log(`  → ${searchUrl}`);

      try {
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await randomDelay(2000, 3500);

        const listings = await scrapeListingsFromPage(page, platform.name, platform.baseUrl);
        console.log(`  📋 Found ${listings.length} listings on ${platform.name}`);

        for (const listing of listings.slice(0, 3)) {
          totalScraped++;
          const description = await fetchJobDescription(page, listing.url);
          const fullText = `${listing.title} ${description}`;

          // ── REGEX FILTER CHECK ──
          if (CITIZENSHIP_PR_DISQUALIFY_REGEX.test(fullText)) {
            totalDropped++;
            const match = fullText.match(CITIZENSHIP_PR_DISQUALIFY_REGEX)[0];
            console.log(`  ❌ DROPPED [PR/Citizen Restriction: "${match}"]: "${listing.title}" @ ${listing.company}`);
            continue;
          }

          // Calculate priority score — Technology One roles prioritized
          const priorityScore = calculatePriorityScore(listing.title, description, query);

          const record = await prisma.jobPosting.upsert({
            where: { url: listing.url },
            create: {
              title: listing.title,
              company: listing.company,
              url: listing.url,
              description: description,
              status: "NEW",
              priority_score: priorityScore,
              source: platform.name,
              location: "Sydney, Australia",
            },
            update: {
              title: listing.title,
              company: listing.company,
              description: description,
              priority_score: priorityScore,
              updatedAt: new Date(),
            },
          });

          totalSaved++;
          console.log(`  ✅ SAVED [Priority Score: ${priorityScore} | Source: ${platform.name}]: "${record.title}" @ ${record.company}`);
        }
      } catch (err) {
        console.error(`  ⚠️ Notice during search for "${query}" on ${platform.name}: ${err.message}`);
      }
    }
  }

  await browser.close();

  // Summary
  const countInDb = await prisma.jobPosting.count();
  console.log("\n" + "═".repeat(60));
  console.log(`📊 SUMMARY: Scraped: ${totalScraped} | Dropped (PR/Citizen): ${totalDropped} | Saved: ${totalSaved}`);
  console.log(`💾 Total Records in PostgreSQL Database: ${countInDb}\n`);

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("💥 Fatal error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
