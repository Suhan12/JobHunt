/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  JobHunt Scraper — Puppeteer + Stealth + PostgreSQL                ║
 * ║                                                                     ║
 * ║  Scrapes data analyst & software engineering jobs in Sydney from    ║
 * ║  Indeed Australia, extracts title/company/url/description, and      ║
 * ║  upserts them into the JobPosting table via Prisma.                 ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

require("dotenv").config();
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const prisma = require("./db");
const path = require("path");
const fs = require("fs");

// Apply stealth evasions (navigator.webdriver, chrome.runtime, etc.)
puppeteer.use(StealthPlugin());

// ── Configuration ─────────────────────────────────────────────────────
const SEARCHES = [
  { query: "data analyst", location: "Sydney NSW" },
  { query: "software engineer", location: "Sydney NSW" },
];

const SCREENSHOT_DIR = path.join(__dirname, "..", "screenshots");
const MAX_PAGES_PER_SEARCH = 1; // Keep it light for demo; increase for production
const BASE_URL = "https://au.indeed.com";

// ── Helpers ───────────────────────────────────────────────────────────

/** Random delay between min/max ms — mimics human pacing */
function randomDelay(min = 1500, max = 4000) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Take a timestamped screenshot and return the file path */
async function screenshot(page, label) {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const filename = `${label}_${Date.now()}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`  📸 Screenshot saved: ${filepath}`);
  return filepath;
}

/** Slowly type text with random per-key delays */
async function humanType(page, selector, text) {
  await page.click(selector, { clickCount: 3 }); // select-all first
  for (const char of text) {
    await page.type(selector, char, { delay: 50 + Math.random() * 100 });
  }
}

// ── Scraping logic ────────────────────────────────────────────────────

/**
 * Scrape the Indeed search results page and return an array of
 * { title, company, url, relativeUrl } objects.
 */
async function scrapeSearchResults(page) {
  return page.evaluate((baseUrl) => {
    const cards = document.querySelectorAll(".job_seen_beacon, .resultContent, [data-jk]");
    const results = [];
    const seen = new Set();

    cards.forEach((card) => {
      try {
        // Title — multiple possible selectors across Indeed layouts
        const titleEl =
          card.querySelector("h2.jobTitle a") ||
          card.querySelector("h2 a") ||
          card.querySelector('[class*="jobTitle"] a') ||
          card.querySelector("a[data-jk]");

        // Company
        const companyEl =
          card.querySelector('[data-testid="company-name"]') ||
          card.querySelector(".companyName") ||
          card.querySelector('[class*="company"]');

        if (!titleEl) return;

        const title = titleEl.innerText.trim();
        const href = titleEl.getAttribute("href") || "";
        const relativeUrl = href.startsWith("http") ? href : href;
        const fullUrl = href.startsWith("http") ? href : `${baseUrl}${href}`;
        const company = companyEl ? companyEl.innerText.trim() : "Unknown";

        if (title && !seen.has(fullUrl)) {
          seen.add(fullUrl);
          results.push({ title, company, url: fullUrl, relativeUrl: href });
        }
      } catch (_) {
        /* skip malformed cards */
      }
    });

    return results;
  }, BASE_URL);
}

/**
 * Navigate to a job detail page and extract the full description.
 */
async function scrapeJobDescription(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await randomDelay(1000, 2500);

    const description = await page.evaluate(() => {
      const descEl =
        document.querySelector("#jobDescriptionText") ||
        document.querySelector('[class*="jobsearch-JobComponent-description"]') ||
        document.querySelector('[class*="jobDescription"]') ||
        document.querySelector(".jobsearch-jobDescriptionText");
      return descEl ? descEl.innerText.trim() : "";
    });

    return description || "Description not available.";
  } catch (err) {
    console.warn(`  ⚠️  Failed to scrape description from ${url}: ${err.message}`);
    return "Description not available.";
  }
}

// ── Database operations ───────────────────────────────────────────────

async function upsertJob({ title, company, url, description, source, location }) {
  return prisma.jobPosting.upsert({
    where: { url },
    create: { title, company, url, description, source, location, status: "new" },
    update: { title, company, description, updatedAt: new Date() },
  });
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║           JobHunt Scraper — Starting                    ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  // Verify DB connection first
  try {
    await prisma.$connect();
    console.log("✅ Database connected\n");
  } catch (err) {
    console.error("❌ Cannot connect to database:", err.message);
    process.exit(1);
  }

  // Launch browser with stealth
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

  // Extra stealth: realistic user-agent and headers
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  );
  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-AU,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  });

  let allJobs = [];
  let screenshotPaths = [];

  for (const { query, location } of SEARCHES) {
    console.log(`\n🔍 Searching: "${query}" in "${location}"`);
    console.log("─".repeat(50));

    // Build Indeed search URL
    const searchUrl = `${BASE_URL}/jobs?q=${encodeURIComponent(query)}&l=${encodeURIComponent(location)}`;
    console.log(`  → ${searchUrl}`);

    try {
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await randomDelay(2000, 4000);

      // Screenshot the search results page
      const ssPath = await screenshot(page, `search_${query.replace(/\s+/g, "_")}`);
      screenshotPaths.push(ssPath);

      // Scrape job cards from search results
      const listings = await scrapeSearchResults(page);
      console.log(`  📋 Found ${listings.length} listings on page`);

      if (listings.length === 0) {
        console.log("  ⚠️  No listings found — page may have changed or bot detection triggered");
        // Still take a screenshot to debug
        await screenshot(page, `empty_results_${query.replace(/\s+/g, "_")}`);
        continue;
      }

      // Visit each job detail page to get full description
      for (const listing of listings.slice(0, 5)) {
        // Limit to 5 per search for demo
        console.log(`\n  📄 "${listing.title}" @ ${listing.company}`);

        await randomDelay(1500, 3000);
        const description = await scrapeJobDescription(page, listing.url);
        const descPreview = description.substring(0, 80).replace(/\n/g, " ");
        console.log(`     Description: ${descPreview}...`);

        // Screenshot the job detail page
        const detailSs = await screenshot(
          page,
          `detail_${listing.title.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 30)}`
        );
        screenshotPaths.push(detailSs);

        allJobs.push({
          title: listing.title,
          company: listing.company,
          url: listing.url,
          description,
          source: "indeed",
          location: "Sydney",
        });
      }
    } catch (err) {
      console.error(`  ❌ Error during search for "${query}": ${err.message}`);
      await screenshot(page, `error_${query.replace(/\s+/g, "_")}`);
    }
  }

  // ── Insert into database ──────────────────────────────────────────
  console.log("\n" + "═".repeat(50));
  console.log("💾 Saving jobs to database...\n");

  let inserted = 0;
  for (const job of allJobs) {
    try {
      const record = await upsertJob(job);
      inserted++;
      console.log(`  ✅ [${inserted}] ${record.title} @ ${record.company}`);
      console.log(`     ID: ${record.id}`);
    } catch (err) {
      console.error(`  ❌ Failed to save "${job.title}": ${err.message}`);
    }
  }

  // ── Final verification ────────────────────────────────────────────
  const totalInDb = await prisma.jobPosting.count();
  const recentJobs = await prisma.jobPosting.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, title: true, company: true, status: true, source: true, createdAt: true },
  });

  console.log("\n" + "═".repeat(50));
  console.log(`📊 Database Summary: ${totalInDb} total job postings\n`);
  console.log("Recent entries:");
  recentJobs.forEach((j, i) => {
    console.log(`  ${i + 1}. "${j.title}" @ ${j.company} [${j.status}] (${j.source})`);
  });

  // Final screenshot
  await page.goto("about:blank");
  await page.setContent(`
    <html>
      <head><style>
        body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; padding: 40px; }
        h1 { color: #38bdf8; } h2 { color: #7dd3fc; margin-top: 24px; }
        table { border-collapse: collapse; width: 100%; margin-top: 16px; }
        th, td { border: 1px solid #334155; padding: 10px 14px; text-align: left; }
        th { background: #1e293b; color: #38bdf8; }
        tr:nth-child(even) { background: #1e293b; }
        .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
        .badge-new { background: #065f46; color: #6ee7b7; }
        .badge-indeed { background: #1e3a5f; color: #7dd3fc; }
        .stat { font-size: 48px; font-weight: 700; color: #38bdf8; }
      </style></head>
      <body>
        <h1>🎯 JobHunt Scraper — Results</h1>
        <p><span class="stat">${inserted}</span> jobs scraped and saved</p>
        <p>${totalInDb} total records in database</p>
        <h2>Recent Entries</h2>
        <table>
          <tr><th>#</th><th>Title</th><th>Company</th><th>Status</th><th>Source</th></tr>
          ${recentJobs
            .map(
              (j, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${j.title}</td>
              <td>${j.company}</td>
              <td><span class="badge badge-new">${j.status}</span></td>
              <td><span class="badge badge-indeed">${j.source}</span></td>
            </tr>`
            )
            .join("")}
        </table>
        <p style="margin-top: 24px; color: #64748b;">Scraped at ${new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney" })}</p>
      </body>
    </html>
  `);
  const finalSs = await screenshot(page, "final_results_summary");
  screenshotPaths.push(finalSs);

  console.log(`\n📸 ${screenshotPaths.length} screenshots saved to ${SCREENSHOT_DIR}`);

  await browser.close();
  await prisma.$disconnect();

  console.log("\n✅ Scraper complete!");
  process.exit(0);
}

main().catch(async (err) => {
  console.error("💥 Fatal error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
