/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  Auto-Apply Form Filler Script (Greenhouse / Workday / Generic)    ║
 * ║                                                                     ║
 * ║  Fetches an Application record from PostgreSQL, launches Puppeteer, ║
 * ║  navigates to the job application URL, maps candidate details and   ║
 * ║  the tailored cover letter into form fields WITHOUT submitting.     ║
 * ║  Saves a screenshot for visual verification.                        ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 *  Usage:
 *    node src/auto-apply.js [applicationId] [optionalFormUrl]
 */

require("dotenv").config();
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const prisma = require("./db");
const path = require("path");
const fs = require("fs");

puppeteer.use(StealthPlugin());

// Candidate Profile Data
const CANDIDATE = {
  firstName: "Suhan",
  lastName: "Gautam",
  fullName: "Suhan Gautam",
  email: "suhangautam@gmail.com",
  phone: "+61 0411061575",
  github: "https://github.com/Suhan12",
  linkedin: "https://linkedin.com/in/suhan-gautam",
  location: "Sydney, NSW, Australia",
};

const SCREENSHOT_DIR = path.join(__dirname, "..", "screenshots");
const ARTIFACT_DIR = "C:\\Users\\Suhan Gautam\\.gemini\\antigravity\\brain\\ed1847d3-fa8d-4c7f-ad10-fb69405bb312";

async function fillField(page, selectors, text) {
  for (const selector of selectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        await page.evaluate((element) => element.scrollIntoView({ block: "center" }), el);
        // Fast fill using DOM evaluation for large text blocks, or typing for inputs
        await page.evaluate((element, val) => {
          element.value = val;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }, el, text);
        console.log(`   ✅ Filled field [${selector}]`);
        return true;
      }
    } catch (_) {}
  }
  return false;
}

async function fillGreenhouseOrWorkdayForm(page, application) {
  console.log("📝 Mapping user details and cover letter into form fields...");

  // 1. First Name
  await fillField(
    page,
    [
      "#first_name",
      'input[name="job_application[first_name]"]',
      'input[autocomplete="given-name"]',
      '[data-automation-id="legalNameSection_firstName"]',
      'input[id*="first_name"]',
      'input[name*="first_name"]',
      '#firstName',
      'input[name="firstName"]',
    ],
    CANDIDATE.firstName
  );

  // 2. Last Name
  await fillField(
    page,
    [
      "#last_name",
      'input[name="job_application[last_name]"]',
      'input[autocomplete="family-name"]',
      '[data-automation-id="legalNameSection_lastName"]',
      'input[id*="last_name"]',
      'input[name*="last_name"]',
      '#lastName',
      'input[name="lastName"]',
    ],
    CANDIDATE.lastName
  );

  // Full Name (if single field)
  await fillField(
    page,
    [
      'input[name="name"]',
      '#name',
      'input[id*="full_name"]',
      'input[name*="full_name"]',
    ],
    CANDIDATE.fullName
  );

  // 3. Email
  await fillField(
    page,
    [
      "#email",
      'input[name="job_application[email]"]',
      'input[type="email"]',
      '[data-automation-id="email"]',
      '#emailAddress',
      'input[name="email"]',
    ],
    CANDIDATE.email
  );

  // 4. Phone
  await fillField(
    page,
    [
      "#phone",
      'input[name="job_application[phone]"]',
      'input[type="tel"]',
      '[data-automation-id="phone"]',
      'input[name="phone"]',
      '#phoneNumber',
    ],
    CANDIDATE.phone
  );

  // 5. LinkedIn URL
  await fillField(
    page,
    [
      'input[id*="linkedin"]',
      'input[name*="linkedin"]',
      'input[id*="urls[LinkedIn]"]',
      'input[aria-label*="LinkedIn"]',
      '#linkedin_url',
    ],
    CANDIDATE.linkedin
  );

  // 6. GitHub / Portfolio URL
  await fillField(
    page,
    [
      'input[id*="github"]',
      'input[name*="github"]',
      'input[id*="urls[GitHub]"]',
      'input[aria-label*="GitHub"]',
      '#github_url',
      'input[id*="portfolio"]',
      'input[name*="portfolio"]',
    ],
    CANDIDATE.github
  );

  // 7. Cover Letter Text
  const coverLetterText = application.coverLetter;
  await fillField(
    page,
    [
      "#cover_letter_text",
      'textarea[name="job_application[cover_letter_text]"]',
      'textarea[id*="cover_letter"]',
      'textarea[name*="cover_letter"]',
      'textarea[data-automation-id*="coverLetter"]',
      'textarea',
    ],
    coverLetterText
  );

  console.log("⚠️  Form populated. STOPPING BEFORE SUBMISSION (Submit button left untouched).");
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║     Auto-Apply Form Filler (Greenhouse / Workday)       ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  await prisma.$connect();

  const appId = process.argv[2];
  let application;

  if (appId) {
    application = await prisma.application.findUnique({
      where: { id: appId },
      include: { jobPosting: true },
    });
  } else {
    application = await prisma.application.findFirst({
      orderBy: { createdAt: "desc" },
      include: { jobPosting: true },
    });
  }

  if (!application) {
    console.error("❌ No application record found in database!");
    process.exit(1);
  }

  console.log(`📋 Loaded Application ID: ${application.id}`);
  console.log(`   Job: "${application.jobPosting.title}" @ ${application.jobPosting.company}`);

  const targetUrl = process.argv[3] || application.jobPosting.url;
  console.log(`🌐 Application URL: ${targetUrl}`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1280,960"],
    defaultViewport: { width: 1280, height: 960 },
  });

  const page = await browser.newPage();

  try {
    console.log("🚀 Navigating to application page...");
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));

    await fillGreenhouseOrWorkdayForm(page, application);

    // Save screenshots
    if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const screenshotPathLocal = path.join(SCREENSHOT_DIR, "filled_application.png");
    await page.screenshot({ path: screenshotPathLocal, fullPage: true });
    console.log(`📸 Local screenshot saved: ${screenshotPathLocal}`);

    if (fs.existsSync(ARTIFACT_DIR)) {
      const artifactScreenshotPath = path.join(ARTIFACT_DIR, "filled_application.png");
      fs.copyFileSync(screenshotPathLocal, artifactScreenshotPath);
      console.log(`📸 Artifact screenshot copied: ${artifactScreenshotPath}`);
    }
  } catch (err) {
    console.error("❌ Error during form filling:", err.message);
  } finally {
    await browser.close();
    await prisma.$disconnect();
    console.log("✅ Auto-apply process complete.");
  }
}

main();
