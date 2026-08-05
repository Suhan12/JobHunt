require("dotenv").config();
const prisma = require("./db");

async function main() {
  // Reset jobs and clean up any partial applications
  const ids = [
    "14878bf1-15a2-4ce1-903a-0bbd1ea01b2d",
    "16e32736-4c69-48d6-a0b3-70f8c13d0c5c",
  ];

  // Delete any existing applications for these jobs
  const deleted = await prisma.application.deleteMany({
    where: { jobPostingId: { in: ids } },
  });
  console.log(`Deleted ${deleted.count} existing application(s)`);

  // Reset status back to "new"
  const updated = await prisma.jobPosting.updateMany({
    where: { id: { in: ids } },
    data: { status: "new" },
  });
  console.log(`Reset ${updated.count} job(s) to "new" status`);

  await prisma.$disconnect();
}
main();
