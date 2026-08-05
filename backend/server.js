/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  JobHunt Express API Server (server.js)                             ║
 * ║                                                                     ║
 * ║  Endpoints:                                                         ║
 * ║    • GET  /jobs      Fetch listings sorted by priority_score desc   ║
 * ║    • POST /generate  Draft targeted cover letter via Groq Llama 3.3 ║
 * ║    • GET  /health    Health check endpoint                          ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const Groq = require("groq-sdk");
const googleIt = require("google-it");
const prisma = require("./src/db");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Serve Flutter web build if built into public folder
const flutterWebPath = path.join(__dirname, "..", "mobile_reviewer", "build", "web");
if (fs.existsSync(flutterWebPath)) {
  app.use(express.static(flutterWebPath));
}

const RESUME_PATH = path.join(__dirname, "master_resume.txt");
const MODEL = "llama-3.3-70b-versatile";
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Hiring Manager Discovery Helper ───────────────────────────────────

function parseNameWithRegex(text) {
  if (!text) return null;
  const titleParts = text.split(/[-–|]/);
  if (titleParts.length > 0) {
    const rawName = titleParts[0].trim();
    if (/^[A-Z][a-z]{1,15}\s+[A-Z][a-z]{1,15}$/.test(rawName)) {
      return rawName;
    }
  }
  const match = text.match(/\b([A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,15})\b/);
  if (match) {
    const candidate = match[1];
    const ignoreList = [
      "Transport For", "Transport Nsw", "Hiring Manager", "Senior Talent",
      "Talent Acquisition", "LinkedIn Profile", "Data Analyst", "Software Engineer",
    ];
    if (!ignoreList.some((ign) => candidate.toLowerCase().includes(ign.toLowerCase()))) {
      return candidate;
    }
  }
  return null;
}

async function discoverHiringManager(companyName, jobDescription = "") {
  const emailContactMatch = jobDescription.match(/contact\s+([A-Z\.\_]+)@/i);
  if (emailContactMatch) {
    const rawEmailName = emailContactMatch[1].replace(/[\._]/g, " ");
    const formattedName = rawEmailName
      .toLowerCase()
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
    if (formattedName.split(" ").length >= 2) return formattedName;
  }

  try {
    const query = `site:linkedin.com/in/ "${companyName}" ("hiring manager" OR "talent" OR "recruiter")`;
    const results = await googleIt({ query, limit: 3, "no-display": true });
    for (const result of results.slice(0, 3)) {
      const extracted = parseNameWithRegex(`${result.title} ${result.snippet}`);
      if (extracted) return extracted;
    }
  } catch (_) {}

  return "Hiring Team";
}

// ── API Routes ────────────────────────────────────────────────────────

// Health check
app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "connected", timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: "error", db: "disconnected", error: err.message });
  }
});

// GET /jobs — fetch listings sorted by priority_score descending
app.get(["/jobs", "/api/jobs"], async (_req, res) => {
  try {
    const jobs = await prisma.jobPosting.findMany({
      orderBy: { priority_score: "desc" },
      include: { applications: true },
    });
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /generate — draft tailored cover letter via Groq SDK
app.get("/api/jobs/:id", async (req, res) => {
  try {
    const job = await prisma.jobPosting.findUnique({
      where: { id: req.params.id },
      include: { applications: true },
    });
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post(["/generate", "/api/generate"], async (req, res) => {
  try {
    const { jobId } = req.body;
    if (!jobId) return res.status(400).json({ error: "jobId is required" });

    const job = await prisma.jobPosting.findUnique({ where: { id: jobId } });
    if (!job) return res.status(404).json({ error: "Job posting not found" });

    const resume = fs.existsSync(RESUME_PATH) ? fs.readFileSync(RESUME_PATH, "utf-8") : "Master resume data.";

    const hiringManager = await discoverHiringManager(job.company, job.description);

    const systemPrompt = `You are a high-converting career consultant. You write hyper-targeted, ultra-concise cover letters. Your letters are short, impactful, and directly reference specific technologies or projects from the job description.`;
    const userPrompt = `Write a targeted cover letter for this candidate applying to ${job.company}.

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
2. SPECIFIC HOOK: Reference at least one SPECIFIC requirement, tool, or project mentioned in the job description.
3. LENGTH LIMIT: Keep the ENTIRE letter highly concise, STRICTLY between 200 and 400 characters total.
4. TONE: Professional, confident, and direct.
5. FORMAT: Plain text only, no placeholders.`;

    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.6,
      max_completion_tokens: 500,
    });

    const coverLetter = (completion.choices[0]?.message?.content || "").trim();

    // Save Application record
    const application = await prisma.application.create({
      data: {
        coverLetter,
        resume,
        applicationDate: new Date(),
        jobPostingId: job.id,
      },
    });

    // Update job status
    await prisma.jobPosting.update({
      where: { id: job.id },
      data: { status: "applied" },
    });

    res.json({
      success: true,
      applicationId: application.id,
      jobId: job.id,
      jobTitle: job.title,
      company: job.company,
      hiringManager,
      charCount: coverLetter.length,
      coverLetter,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, async () => {
  try {
    await prisma.$connect();
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`   GET  /jobs      (sorted by priority_score desc)`);
    console.log(`   POST /generate  (draft cover letter via Groq Llama 3.3)`);
  } catch (err) {
    console.error("❌ Failed to start server:", err.message);
  }
});
