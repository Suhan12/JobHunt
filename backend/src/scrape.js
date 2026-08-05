/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  Job Scraper Engine — Data Analyst, Node.js & Next.js in Sydney     ║
 * ║                                                                     ║
 * ║  1. Searches Indeed AU for Data Analyst, Node.js, and Next.js roles ║
 * ║  2. Extracts title, company, url, full job description              ║
 * ║  3. REGEX FILTER: Drops any job containing 'Australian Citizen'     ║
 * ║     or 'Permanent Resident' restrictions                           ║
 * ║  4. Calculates priority_score based on key tech stack matches       ║
 * ║  5. Upserts surviving records to PostgreSQL via Prisma              ║
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

// ── Search Queries & Targets ──────────────────────────────────────────
const SEARCH_TARGETS = [
  { query: "Data Analyst", location: "Sydney NSW" },
  { query: "Node.js", location: "Sydney NSW" },
  { query: "Next.js", location: "Sydney NSW" },
];

const BASE_URL = "https://au.indeed.com";
const SCREENSHOT_DIR = path.join(__dirname, "..", "screenshots");

// ── Regex Filter for Disqualifying Terms ──────────────────────────────
// Drops listings containing 'Australian Citizen' or 'Permanent Resident'
const CITIZENSHIP_PR_DISQUALIFY_REGEX =
  /\b(australian citizen|australian citizenship|permanent resident|permanent residency|pr holder|citizenship required|must be an australian citizen|must be a permanent resident)\b/i;

// Priority score calculation keywords
const HIGH_PRIORITY_KEYWORDS = ["node.js", "nodejs", "next.js", "nextjs", "react", "typescript", "python", "sql", "tableau", "data analyst", "full stack", "ai", "machine learning"];

/** Random delay helper */
function randomDelay(min = 1200, max = 3000) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((r) => setTimeout(r, ms));
}

/** Calculate priority score based on technology & title match density */
function calculatePriorityScore(title, description) {
  let score = 50; // base score
  const text = `${title} ${description}`.toLowerCase();

  HIGH_PRIORITY_KEYWORDS.forEach((kw) => {
    if (text.includes(kw)) score += 10;
  });

  if (text.includes("junior") || text.includes("graduate") || text.includes("mid")) score += 15;
  if (text.includes("senior") || text.includes("lead")) score -= 5;

  return Math.min(Math.max(score, 0), 100);
}

/** Scrape search results from Indeed search page */
async function scrapeListingsFromPage(page) {
  return page.evaluate((baseUrl) => {
    const cards = document.querySelectorAll(".job_seen_beacon, .resultContent, [data-jk]");
    const results = [];
    const seen = new Set();

    cards.forEach((card) => {
      try {
        const titleEl =
          card.querySelector("h2.jobTitle a") ||
          card.querySelector("h2 a") ||
          card.querySelector('[class*="jobTitle"] a') ||
          card.querySelector("a[data-jk]");

        const companyEl =
          card.querySelector('[data-testid="company-name"]') ||
          card.querySelector(".companyName") ||
          card.querySelector('[class*="company"]');

        if (!titleEl) return;

        const title = titleEl.innerText.trim();
        const href = titleEl.getAttribute("href") || "";
        const fullUrl = href.startsWith("http") ? href : `${baseUrl}${href}`;
        const company = companyEl ? companyEl.innerText.trim() : "Unknown";

        if (title && !seen.has(fullUrl)) {
          seen.add(fullUrl);
          results.push({ title, company, url: fullUrl });
        }
      } catch (_) {}
    });

    return results;
  }, BASE_URL);
}

/** Extract description text from detail page */
async function fetchJobDescription(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await randomDelay(1000, 2000);

    const description = await page.evaluate(() => {
      const el =
        document.querySelector("#jobDescriptionText") ||
        document.querySelector('[class*="jobsearch-JobComponent-description"]') ||
        document.querySelector('[class*="jobDescription"]') ||
        document.querySelector(".jobsearch-jobDescriptionText");
      return el ? el.innerText.trim() : "";
    });

    return description || "Detailed description not available.";
  } catch (err) {
    return "Detailed description not available.";
  }
}

// ── Main Scraping Execution ───────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║    JobScraper Engine — Data Analyst, Node.js, Next.js   ║");
  console.log("║    Regex Filter: Dropping Citizen / PR Restrictions     ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  await prisma.$connect();
  console.log("✅ Database connected");

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1920,1080",
    ],
    defaultViewport: { width: 1920, height: 1080 },
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  );

  let totalScraped = 0;
  let totalDropped = 0;
  let totalSaved = 0;

  for (const { query, location } of SEARCH_TARGETS) {
    console.log(`\n🔍 Searching: "${query}" in "${location}"`);
    console.log("─".repeat(60));

    const searchUrl = `${BASE_URL}/jobs?q=${encodeURIComponent(query)}&l=${encodeURIComponent(location)}`;
    console.log(`  → ${searchUrl}`);

    try {
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await randomDelay(2000, 3500);

      const listings = await scrapeListingsFromPage(page);
      console.log(`  📋 Found ${listings.length} listings`);

      for (const listing of listings.slice(0, 4)) {
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

        // Passed filter -> calculate priority_score and save
        const priorityScore = calculatePriorityScore(listing.title, description);

        const record = await prisma.jobPosting.upsert({
          where: { url: listing.url },
          create: {
            title: listing.title,
            company: listing.company,
            url: listing.url,
            description: description,
            status: "new",
            priority_score: priorityScore,
            source: "indeed",
            location: "Sydney",
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
        console.log(`  ✅ SAVED [Priority Score: ${priorityScore}]: "${record.title}" @ ${record.company}`);
        console.log(`     ID: ${record.id}`);
      }
    } catch (err) {
      console.error(`  ❌ Error during search for "${query}": ${err.message}`);
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
