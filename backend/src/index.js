require("dotenv").config();
const express = require("express");
const cors = require("cors");
const prisma = require("./db");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────
app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "connected", timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: "error", db: "disconnected", error: err.message });
  }
});

// ── Job Postings CRUD ─────────────────────────────────────────────────
app.get("/api/jobs", async (_req, res) => {
  const jobs = await prisma.jobPosting.findMany({
    orderBy: { createdAt: "desc" },
    include: { applications: true },
  });
  res.json(jobs);
});

app.get("/api/jobs/:id", async (req, res) => {
  const job = await prisma.jobPosting.findUnique({
    where: { id: req.params.id },
    include: { applications: true },
  });
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

app.patch("/api/jobs/:id/status", async (req, res) => {
  const { status } = req.body;
  const job = await prisma.jobPosting.update({
    where: { id: req.params.id },
    data: { status },
  });
  res.json(job);
});

// ── Applications ──────────────────────────────────────────────────────
app.post("/api/jobs/:id/apply", async (req, res) => {
  const { coverLetter, resume } = req.body;
  const application = await prisma.application.create({
    data: {
      coverLetter,
      resume,
      jobPostingId: req.params.id,
    },
  });
  // Also update job status
  await prisma.jobPosting.update({
    where: { id: req.params.id },
    data: { status: "applied" },
  });
  res.status(201).json(application);
});

// ── Start server ──────────────────────────────────────────────────────
app.listen(PORT, async () => {
  try {
    await prisma.$connect();
    console.log(`✅ Backend running on http://localhost:${PORT}`);
    console.log(`✅ Database connected`);
  } catch (err) {
    console.error("❌ Failed to connect to database:", err.message);
    process.exit(1);
  }
});
