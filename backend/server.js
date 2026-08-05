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

// Enable CORS for API routes
app.use(cors());

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

// PATCH /jobs/:id/status — update job status (state machine)
const VALID_STATUSES = ["NEW", "REVIEWED", "COVER_LETTER_GENERATED", "COVER_LETTER_SAVED", "SAVED", "APPLIED", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"];

app.patch(["/jobs/:id/status", "/api/jobs/:id/status"], async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "status is required" });

    const upperStatus = status.toUpperCase();
    if (!VALID_STATUSES.includes(upperStatus)) {
      return res.status(400).json({
        error: `Invalid status '${status}'. Valid: ${VALID_STATUSES.join(", ")}`,
      });
    }

    const job = await prisma.jobPosting.findUnique({ where: { id: req.params.id } });
    if (!job) return res.status(404).json({ error: "Job posting not found" });

    const updated = await prisma.jobPosting.update({
      where: { id: req.params.id },
      data: { status: upperStatus },
    });

    res.json({
      success: true,
      id: updated.id,
      title: updated.title,
      company: updated.company,
      previousStatus: job.status,
      newStatus: updated.status,
    });
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

    const systemPrompt = `You are an expert career coach writing a highly detailed, comprehensive, and professional cover letter. The candidate is a Data Analyst currently working at Sutherland Shire Council, holding a Master of Information Technology from UNSW. Their technical stack includes Flutter, Next.js, Node.js, Prisma, PostgreSQL, AWS, and Azure. Map these specific experiences directly to the provided job description. Ensure the output is a multi-paragraph, formal letter, not a brief summary.`;

    const coverLetterTemplate = `REFERENCE TEMPLATE FORMAT (use this structure and tone as a guide):

SUHAN GAUTAM
☎ +61 0411 061 575 ✉ suhangautam@gmail.com 🔗 linkedin.com/in/suhan-gautam

[Today's Date]

[Hiring Contact Name or "Hiring Team"]
[Company Name]
[Location]

Dear [Hiring Contact],

[Opening paragraph: Express strong interest in the specific role. Mention your background in enterprise data migration, data quality frameworks, and stakeholder engagement. Connect your analytical mindset and technical expertise to the company's specific initiative described in the job posting.]

[Second paragraph: Describe your current role at Sutherland Shire Council leading critical data extraction, profiling, and mapping activities. Mention decommissioning legacy systems, designing ETL processes, driving data quality improvement from 56% to 96%. Connect this directly to the job's technical requirements.]

[Third paragraph: Highlight domain knowledge relevant to the role. Reference your work developing Elithia—an AI-powered compliance engine for the Australian aged care sector. Describe navigating healthcare data complexities, understanding clinical workflows, mapping unstructured data, and adhering to data privacy and governance standards.]

[Fourth paragraph: Emphasize collaborative skills. Mention leading requirements workshops, defining enterprise data standards, providing internal application support, and improving data consistency, usability, and user adoption.]

[Closing paragraph: Express enthusiasm for the company's mission. Mention willingness to relocate if applicable. Thank them and mention attached resume.]

Best regards,
Suhan Gautam`;

    const userPrompt = `Write a comprehensive, multi-paragraph cover letter for this candidate applying to ${job.company}.

CANDIDATE RESUME:
${resume}

${coverLetterTemplate}

JOB DETAILS:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location || "Sydney"}
Hiring Contact: ${hiringManager}

Full Job Description:
${job.description.substring(0, 3000)}

STRICT RULES:
1. GREETING: Start with "Dear ${hiringManager},"
2. HEADER: Include the candidate's contact info header (name, phone, email, LinkedIn) at the top, followed by today's date, then the company address block.
3. STRUCTURE: Write 4-5 substantial paragraphs following the template structure above.
4. SPECIFICITY: Reference at LEAST 3 specific requirements, tools, technologies, or projects from the job description and map them to the candidate's experience.
5. TECHNICAL DEPTH: Mention specific technologies from the candidate's stack (Flutter, Next.js, Node.js, Prisma, PostgreSQL, AWS, Azure) where relevant to the job.
6. DATA EXPERTISE: Highlight the candidate's data quality improvement achievement (56% to 96%) and ETL experience.
7. ELITHIA PROJECT: Reference the Elithia AI compliance engine project if healthcare/aged care/compliance is relevant.
8. TONE: Professional, confident, detailed, and enthusiastic.
9. LENGTH: The letter should be 400-600 words minimum. This is NOT a brief note—it is a full professional cover letter.
10. FORMAT: Plain text only, no markdown, no placeholders, no brackets.
11. SIGN-OFF: End with "Best regards,\\nSuhan Gautam"`;

    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_completion_tokens: 2000,
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
      data: { status: "APPLIED" },
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

// POST /generate-docx — generate a formatted Word document from cover letter text
const { Document, Paragraph, TextRun, Packer, AlignmentType, HeadingLevel, convertInchesToTwip } = require("docx");

app.post(["/generate-docx", "/api/generate-docx"], async (req, res) => {
  try {
    const { coverLetter, candidateName, jobTitle, company } = req.body;
    if (!coverLetter) return res.status(400).json({ error: "coverLetter text is required" });

    const name = candidateName || "Suhan Gautam";
    const lines = coverLetter.split("\n").filter((l) => l.trim().length > 0);

    const children = [];

    // Header: Candidate name
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
        children: [
          new TextRun({ text: name.toUpperCase(), bold: true, size: 28, font: "Calibri" }),
        ],
      })
    );

    // Contact info line (if present in first lines)
    const contactLine = lines.find((l) => l.includes("@") || l.includes("☎") || l.includes("+61"));
    if (contactLine) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [
            new TextRun({ text: contactLine, size: 20, font: "Calibri", color: "555555" }),
          ],
        })
      );
    }

    // Body paragraphs
    for (const line of lines) {
      if (line === contactLine) continue;
      if (line.toUpperCase() === name.toUpperCase()) continue;

      const isSignOff = line.startsWith("Best regards") || line.startsWith("Sincerely") || line.startsWith("Kind regards");
      const isName = line.trim() === name;

      children.push(
        new Paragraph({
          spacing: { after: isSignOff || isName ? 80 : 200 },
          children: [
            new TextRun({
              text: line,
              size: 22,
              font: "Calibri",
              bold: isName,
            }),
          ],
        })
      );
    }

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: convertInchesToTwip(1),
                bottom: convertInchesToTwip(1),
                left: convertInchesToTwip(1),
                right: convertInchesToTwip(1),
              },
            },
          },
          children,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = `${name.replace(/\s+/g, "_")}_${(company || "Cover").replace(/\s+/g, "_")}_Cover_Letter.docx`;

    res.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": buffer.length,
    });
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, async () => {
  try {
    await prisma.$connect();
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`   GET    /jobs              (sorted by priority_score desc)`);
    console.log(`   PATCH  /jobs/:id/status   (update job status)`);
    console.log(`   POST   /generate          (draft cover letter via Groq Llama 3.3)`);
    console.log(`   POST   /generate-docx     (export cover letter as Word .docx)`);
  } catch (err) {
    console.error("❌ Failed to start server:", err.message);
  }
});
