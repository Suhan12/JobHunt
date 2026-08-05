const { PrismaClient } = require("@prisma/client");

// Singleton pattern — prevents multiple Prisma clients in dev (nodemon restarts)
const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.__prisma ||
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prisma;
}

module.exports = prisma;
