require("dotenv").config();
const prisma = require("./db");

async function main() {
  const jobs = await prisma.jobPosting.findMany({
    where: { status: "new" },
    take: 2,
    select: { id: true, title: true, company: true, description: true },
  });
  console.log(JSON.stringify(jobs, null, 2));
  await prisma.$disconnect();
}
main();
