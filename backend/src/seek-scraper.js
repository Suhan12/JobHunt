/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  Seek.com.au Scraper Engine — Sydney, Australia                     ║
 * ║                                                                     ║
 * ║  1. Uses Playwright Extra + Stealth & PROXY_URL support              ║
 * ║  2. Scrapes Seek job listings across pages 1 & 2                    ║
 * ║  3. Extracts title, company, URL, and full job description          ║
 * ║  4. REGEX FILTER: Drops any job containing 'Australian Citizen'     ║
 * ║     or 'Permanent Resident' restrictions                           ║
 * ║  5. Gives top priority (100) to 'Technology One Consultant' roles   ║
 * ║  6. Upserts surviving records to PostgreSQL via Prisma              ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 *  Usage: node src/seek-scraper.js
 */

require("dotenv").config();
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
const prisma = require("./db");

chromium.use(stealth);

const PROXY_URL = process.env.PROXY_URL || null;
const SEEK_BASE = "https://www.seek.com.au";

const SEARCH_TARGETS = [
  { term: "Technology-One-Consultant", queryName: "Technology One Consultant" },
  { term: "Data-Analyst", queryName: "Data Analyst" },
  { term: "Node.js", queryName: "Node.js" },
  { term: "Next.js", queryName: "Next.js" },
];

// ── Regex Filter for Disqualifying Terms ──────────────────────────────
const CITIZENSHIP_PR_DISQUALIFY_REGEX =
  /\b(australian citizen|australian citizenship|permanent resident|permanent residency|pr holder|citizenship required|must be an australian citizen|must be a permanent resident)\b/i;

const HIGH_PRIORITY_KEYWORDS = [
  "node.js", "nodejs", "next.js", "nextjs", "react", "typescript",
  "python", "sql", "tableau", "data analyst", "full stack", "ai", "machine learning",
];

function randomDelay(min = 1500, max = 3000) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((r) => setTimeout(r, ms));
}

function calculatePriorityScore(title, description, queryName) {
  let score = 50;
  const text = `${title} ${description}`.toLowerCase();

  if (text.includes("technology one") || text.includes("technologyone") || queryName.toLowerCase().includes("technology one")) {
    score += 50;
  }

  HIGH_PRIORITY_KEYWORDS.forEach((kw) => {
    if (text.includes(kw)) score += 10;
  });

  if (text.includes("junior") || text.includes("graduate") || text.includes("mid")) score += 15;
  if (text.includes("senior") || text.includes("lead")) score -= 5;

  return Math.min(Math.max(score, 0), 100);
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  Seek.com.au Scraper Engine — Playwright Stealth          ║");
  console.log(`║  Proxy: ${(PROXY_URL ? "ENABLED" : "DISABLED").padEnd(46)}║`);
  console.log("║  Target: Pages 1 & 2 | Filter: Citizen / PR Drop          ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  await prisma.$connect();
  console.log("✅ Database connected");

  // Parse proxy server if available
  let launchOptions = {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  };

  if (PROXY_URL) {
    console.log(`📡 Configuring proxy server for Playwright`);
    try {
      const parsed = new URL(PROXY_URL);
      if (parsed.username && parsed.password) {
        launchOptions.proxy = {
          server: `${parsed.protocol}//${parsed.host}`,
          username: parsed.username,
          password: parsed.password,
        };
      } else {
        launchOptions.proxy = { server: PROXY_URL };
      }
    } catch (_) {
      launchOptions.proxy = { server: PROXY_URL };
    }
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  let totalScraped = 0;
  let totalDropped = 0;
  let totalSaved = 0;

  for (const { term, queryName } of SEARCH_TARGETS) {
    // Scrape Pages 1 & 2
    for (let pageNum = 1; pageNum <= 2; pageNum++) {
      const pageParam = pageNum > 1 ? `?page=${pageNum}` : "";
      const searchUrl = `${SEEK_BASE}/${term}-jobs/in-All-Sydney-NSW${pageParam}`;
      console.log(`\n🔍 [Seek Page ${pageNum}] Searching "${queryName}": ${searchUrl}`);

      try {
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await randomDelay(2000, 3500);

        // Extract job card links and titles from Seek page
        const listings = await page.evaluate((baseUrl) => {
          const cards = document.querySelectorAll(
            "[data-automation='normalJob'], [data-card-type='JobCard'], article, [data-job-id]"
          );
          const results = [];
          const seen = new Set();

          cards.forEach((card) => {
            try {
              const titleEl =
                card.querySelector("[data-automation='jobTitle']") ||
                card.querySelector("a[href*='/job/']") ||
                card.querySelector("h3 a, h2 a");

              const companyEl =
                card.querySelector("[data-automation='jobCompany']") ||
                card.querySelector("[data-automation='job-card-company']");

              if (!titleEl) return;

              const title = titleEl.innerText.trim();
              let href = titleEl.getAttribute("href") || "";
              if (href && !href.startsWith("http")) {
                href = `${baseUrl}${href}`;
              }
              // Clean tracking query params from Seek URLs
              const cleanUrl = href.split("?")[0];
              const company = companyEl ? companyEl.innerText.trim() : "Company";

              if (title && cleanUrl && !seen.has(cleanUrl)) {
                seen.add(cleanUrl);
                results.push({ title, company, url: cleanUrl });
              }
            } catch (_) {}
          });

          return results;
        }, SEEK_BASE);

        console.log(`  📋 Found ${listings.length} listings on Seek (Page ${pageNum})`);

        for (const listing of listings.slice(0, 4)) {
          totalScraped++;
          let description = "Detailed description available on Seek.";

          try {
            await page.goto(listing.url, { waitUntil: "domcontentloaded", timeout: 20000 });
            await randomDelay(1000, 2000);

            description = await page.evaluate(() => {
              const el =
                document.querySelector("[data-automation='jobAdDetails']") ||
                document.querySelector("[data-automation='job-detail-description']") ||
                document.querySelector(".section-job-details");
              return el ? el.innerText.trim() : "";
            });
          } catch (_) {}

          const fullText = `${listing.title} ${description}`;

          // ── REGEX FILTER CHECK ──
          if (CITIZENSHIP_PR_DISQUALIFY_REGEX.test(fullText)) {
            totalDropped++;
            const match = fullText.match(CITIZENSHIP_PR_DISQUALIFY_REGEX)[0];
            console.log(`  ❌ DROPPED [PR/Citizen Restriction: "${match}"]: "${listing.title}" @ ${listing.company}`);
            continue;
          }

          const priorityScore = calculatePriorityScore(listing.title, description, queryName);

          const record = await prisma.jobPosting.upsert({
            where: { url: listing.url },
            create: {
              title: listing.title,
              company: listing.company,
              url: listing.url,
              description: description || "Detailed description available on Seek.",
              status: "NEW",
              priority_score: priorityScore,
              source: "seek",
              location: "Sydney NSW",
            },
            update: {
              title: listing.title,
              company: listing.company,
              description: description || "Detailed description available on Seek.",
              priority_score: priorityScore,
              updatedAt: new Date(),
            },
          });

          totalSaved++;
          console.log(`  ✅ SAVED [Priority: ${priorityScore} | Source: seek]: "${record.title}" @ ${record.company}`);
        }
      } catch (err) {
        console.error(`  ⚠️ Notice on Seek Page ${pageNum} for "${queryName}": ${err.message}`);
      }
    }
  }

  await browser.close();

  const countInDb = await prisma.jobPosting.count();
  console.log("\n" + "═".repeat(60));
  console.log(`📊 SEEK SUMMARY: Scraped: ${totalScraped} | Dropped (PR/Citizen): ${totalDropped} | Saved: ${totalSaved}`);
  console.log(`💾 Total Records in PostgreSQL Database: ${countInDb}\n`);

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("💥 Fatal error in seek-scraper:", err);
  await prisma.$disconnect();
  process.exit(1);
});
