/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  Targeted Cover Letter Generator with Hiring Manager Discovery       ║
 * ║                                                                     ║
 * ║  1. Discovers hiring manager via LinkedIn search & Regex parsing     ║
 * ║  2. Uses Groq (llama-3.3-70b-versatile) to generate EXCLUSIVELY    ║
 * ║     hyper-targeted, highly concise cover letters (200-400 chars)     ║
 * ║  3. Directly addresses the specific contact or 'Hiring Team'         ║
 * ║  4. References specific details from the job description             ║
 * ║  5. Saves to PostgreSQL Application table                            ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 *  Usage:
 *    node src/apply-service.js              # Process all pending jobs
 *    node src/apply-service.js <id1> <id2>  # Process specific job IDs
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const Groq = require("groq-sdk");
const googleIt = require("google-it");
const prisma = require("./db");

// ── Configuration ─────────────────────────────────────────────────────
const RESUME_PATH = path.join(__dirname, "..", "master_resume.txt");
const OUTPUT_DIR = path.join(__dirname, "..", "generated_applications");

const HARD_DELAY_MS = 2_000;         // 2s delay between API calls
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MULTIPLIER = 2;
const BACKOFF_MAX_MS = 60_000;
const JITTER_MAX_MS = 1_500;
const MAX_RETRIES = 4;

const MODEL = "llama-3.3-70b-versatile";

// ── Groq client ───────────────────────────────────────────────────────
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Utilities ─────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle(ms, reason) {
  const jitter = Math.floor(Math.random() * JITTER_MAX_MS);
  const total = ms + jitter;
  console.log(`   ⏳ ${reason} — ${(total / 1000).toFixed(1)}s`);
  await sleep(total);
}

function elapsed(startMs) {
  const s = Math.round((Date.now() - startMs) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

function isRateLimitError(err) {
  if (!err) return false;
  const msg = err.message || "";
  const status = err.status || err.statusCode || 0;
  return status === 429 || msg.includes("429") || msg.includes("rate_limit") || msg.includes("Quota exceeded");
}

// ── Hiring Manager Discovery Function ─────────────────────────────────

/**
 * Parses search title/snippet with Regex to extract potential human name
 */
function parseNameWithRegex(text) {
  if (!text) return null;

  // Title pattern: "Firstname Lastname - Role - Company | LinkedIn"
  const titleParts = text.split(/[-–|]/);
  if (titleParts.length > 0) {
    const rawName = titleParts[0].trim();
    if (/^[A-Z][a-z]{1,15}\s+[A-Z][a-z]{1,15}$/.test(rawName)) {
      return rawName;
    }
  }

  // Regex pattern for 2 capitalized words
  const match = text.match(/\b([A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,15})\b/);
  if (match) {
    const candidate = match[1];
    const ignoreList = [
      "Transport For", "Transport Nsw", "Hiring Manager", "Senior Talent",
      "Talent Acquisition", "LinkedIn Profile", "Data Analyst", "Software Engineer",
      "Human Resources", "Recruitment Lead"
    ];
    if (!ignoreList.some((ign) => candidate.toLowerCase().includes(ign.toLowerCase()))) {
      return candidate;
    }
  }

  return null;
}

/**
 * Executes LinkedIn search and parses top 3 results for Hiring Manager name
 */
async function discoverHiringManager(companyName, jobDescription = "") {
  console.log(`\n🔎 Discovering Hiring Manager for "${companyName}"...`);

  // First check if email contact name exists in job description (e.g. RENEE.GAUDZINSKI@...)
  const emailContactMatch = jobDescription.match(/contact\s+([A-Z\.\_]+)@/i);
  if (emailContactMatch) {
    const rawEmailName = emailContactMatch[1].replace(/[\._]/g, " ");
    const formattedName = rawEmailName
      .toLowerCase()
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
    if (formattedName.split(" ").length >= 2) {
      console.log(`   🎯 Extracted from job contact info: "${formattedName}"`);
      return formattedName;
    }
  }

  // Run search query
  const query = `site:linkedin.com/in/ "${companyName}" ("hiring manager" OR "talent" OR "recruiter")`;
  console.log(`   Query: ${query}`);

  try {
    const results = await googleIt({ query, limit: 3, "no-display": true });
    for (const result of results.slice(0, 3)) {
      const extracted = parseNameWithRegex(`${result.title} ${result.snippet}`);
      if (extracted) {
        console.log(`   🎯 Extracted Name from search: "${extracted}"`);
        return extracted;
      }
    }
  } catch (err) {
    console.log(`   ℹ️ Search query fallback (${err.message})`);
  }

  console.log(`   ℹ️ No specific name extracted. Defaulting to "Hiring Team"`);
  return "Hiring Team";
}

// ── Groq API Call ─────────────────────────────────────────────────────

async function callGroq(systemPrompt, userPrompt) {
  let backoffMs = BACKOFF_BASE_MS;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`   🤖 Calling Groq ${MODEL} (attempt ${attempt}/${MAX_RETRIES})...`);
      const completion = await groq.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.6,
        max_completion_tokens: 500,
      });

      const text = completion.choices[0]?.message?.content || "";
      console.log(`   ✅ Response received (${text.length} chars)`);
      return text.trim();
    } catch (err) {
      if (isRateLimitError(err) && attempt < MAX_RETRIES) {
        const jitter = Math.floor(Math.random() * JITTER_MAX_MS);
        const waitMs = Math.min(backoffMs + jitter, BACKOFF_MAX_MS);
        console.log(`   ⚠️  429 rate limit (attempt ${attempt}/${MAX_RETRIES}). Waiting ${(waitMs / 1000).toFixed(1)}s...`);
        await sleep(waitMs);
        backoffMs = Math.min(backoffMs * BACKOFF_MULTIPLIER, BACKOFF_MAX_MS);
      } else {
        throw err;
      }
    }
  }
}

// ── Cover Letter Prompts (EXCLUSIVELY Cover Letters) ───────────────────

const COVER_LETTER_SYSTEM = `You are a high-converting career consultant. You write hyper-targeted, ultra-concise cover letters. Your letters are short, impactful, and directly reference specific technologies or projects from the job description.`;

function buildCoverLetterUser(resume, job, hiringManager) {
  return `Write a targeted cover letter for this candidate applying to ${job.company}.

CANDIDATE RESUME:
${resume}

JOB DETAILS:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location || "Sydney"}
Hiring Contact: ${hiringManager}

Job Description Snippet:
${job.description.substring(0, 1200)}

STRICT RULES:
1. GREETING: Start directly with "Dear ${hiringManager},"
2. SPECIFIC HOOK: Reference at least one SPECIFIC requirement, tool, or project mentioned in the job description (e.g., specific software, platforms, or responsibilities).
3. LENGTH LIMIT: Keep the ENTIRE letter highly concise, STRICTLY between 200 and 400 characters total (including spaces). 
4. TONE: Professional, confident, and direct.
5. FORMAT: Plain text only, no placeholders, ready to send.`;
}

// ── Process a single job posting ──────────────────────────────────────

async function processJobPosting(job, resume, index, total, isFirstCall) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`🔄 [${index + 1}/${total}] Processing: "${job.title}" @ ${job.company}`);
  console.log(`   ID: ${job.id}`);
  console.log("─".repeat(60));

  // 1. Discover Hiring Manager
  const hiringManager = await discoverHiringManager(job.company, job.description);
  console.log(`👤 Addressing to: "Dear ${hiringManager},"`);

  // Hard delay before Groq call if not first call
  if (!isFirstCall) {
    await throttle(HARD_DELAY_MS, "Stability delay");
  }

  // 2. Generate Cover Letter via Groq
  console.log("\n✍️  Generating ultra-concise cover letter...");
  const coverLetter = await callGroq(
    COVER_LETTER_SYSTEM,
    buildCoverLetterUser(resume, job, hiringManager)
  );

  console.log(`\n📏 Character Count: ${coverLetter.length} chars (Target: 200–400)`);

  // 3. Save to Application table (resume stored as reference copy of master resume)
  console.log("\n💾 Saving to database...");
  const application = await prisma.application.create({
    data: {
      coverLetter,
      resume: resume, // Master resume reference
      applicationDate: new Date(),
      jobPostingId: job.id,
    },
  });

  // 4. Update job status
  await prisma.jobPosting.update({
    where: { id: job.id },
    data: { status: "applied" },
  });

  // 5. Save output file
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const safeCompany = job.company.replace(/[^a-zA-Z0-9]/g, "_");
  const safeTitle = job.title.replace(/[^a-zA-Z0-9]/g, "_");
  const prefix = `${safeTitle}_${safeCompany}`;
  const filePath = path.join(OUTPUT_DIR, `${prefix}_cover_letter.txt`);
  fs.writeFileSync(filePath, coverLetter, "utf-8");

  console.log(`\n✅ Application saved! ID: ${application.id}`);
  console.log(`   📁 Saved file: ${filePath}`);

  return { application, coverLetter, hiringManager, charCount: coverLetter.length };
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   Targeted Cover Letter Generator (Groq Llama 3.3 70B)  ║");
  console.log("║   Features: Hiring Manager Discovery + 200-400 char limit║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  try {
    await prisma.$connect();
    console.log("✅ Database connected");

    // Load master resume
    if (!fs.existsSync(RESUME_PATH)) {
      throw new Error(`Master resume not found at: ${RESUME_PATH}`);
    }
    const resume = fs.readFileSync(RESUME_PATH, "utf-8");
    console.log(`📄 Using ONLY Master Resume: master_resume.txt (${resume.length} chars)`);

    // Determine target jobs
    const specificIds = process.argv.slice(2);
    let jobs;

    if (specificIds.length > 0) {
      jobs = await prisma.jobPosting.findMany({
        where: { id: { in: specificIds } },
      });
      console.log(`🎯 Processing ${jobs.length} specific job(s)`);
    } else {
      jobs = await prisma.jobPosting.findMany({
        where: { status: "new" },
        orderBy: { createdAt: "asc" },
        take: 1, // Default to 1 test record
      });
      console.log(`🔍 Processing 1 pending job posting`);
    }

    if (jobs.length === 0) {
      console.log("ℹ️  No jobs to process. Exiting.");
      return;
    }

    // Sequential loop with 2s delay
    const results = [];
    for (const [index, job] of jobs.entries()) {
      const isFirstCall = index === 0;
      const result = await processJobPosting(job, resume, index, jobs.length, isFirstCall);
      results.push({ job, ...result });
    }

    // Summary
    console.log("\n" + "═".repeat(60));
    console.log(`\n📊 BATCH COMPLETE — ${results.length} targeted cover letter(s) in ${elapsed(startTime)}\n`);

    for (const [i, r] of results.entries()) {
      console.log(`  ${i + 1}. "${r.job.title}" @ ${r.job.company}`);
      console.log(`     Hiring Manager: ${r.hiringManager}`);
      console.log(`     Length: ${r.charCount} characters`);
      console.log(`     Application ID: ${r.application.id}`);
    }

    console.log("\n📊 RESULT_JSON_START");
    console.log(
      JSON.stringify(
        results.map((r) => ({
          success: true,
          applicationId: r.application.id,
          jobTitle: r.job.title,
          company: r.job.company,
          hiringManager: r.hiringManager,
          charCount: r.charCount,
          coverLetter: r.coverLetter,
        })),
        null,
        2
      )
    );
    console.log("RESULT_JSON_END");
  } catch (err) {
    console.error(`\n❌ Fatal error: ${err.message}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
