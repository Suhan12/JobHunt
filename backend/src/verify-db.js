require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

async function verify() {
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    console.log("✅ Database connected successfully!");

    const tables = await prisma.$queryRawUnsafe(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
    );
    console.log("📋 Tables:", tables.map((t) => t.tablename));

    const jobCount = await prisma.jobPosting.count();
    const appCount = await prisma.application.count();
    console.log(`📊 JobPosting records: ${jobCount}`);
    console.log(`📊 Application records: ${appCount}`);

    console.log("\n✅ All checks passed!");
  } catch (err) {
    console.error("❌ Verification failed:", err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

verify();
