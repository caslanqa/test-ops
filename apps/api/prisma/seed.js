// Seed data for development: the first admin user + a sample workspace/project.
// To run: node prisma/seed.js  (or docker compose exec app node prisma/seed.js)
// Safe to re-run: existing records, including the user's password, are left unchanged.
const { PrismaClient, WorkspaceRole, ProjectRole } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@testops.local";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

  // If the user already exists (an earlier seed or a sign-up with the same email), its
  // password is not silently changed; the output below must not imply the new one works.
  // Login matches email case-insensitively, so the lookup does the same.
  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });
  const admin =
    existing ??
    (await prisma.user.create({
      data: {
        email,
        displayName: "Workspace Admin",
        passwordHash: await bcrypt.hash(password, 12),
      },
    }));

  const workspace = await prisma.workspace.upsert({
    where: { slug: "default" },
    update: {},
    create: {
      name: "Default Workspace",
      slug: "default",
      members: { create: { userId: admin.id, role: WorkspaceRole.ADMIN } },
    },
  });

  await prisma.project.upsert({
    where: { workspaceId_key: { workspaceId: workspace.id, key: "DEMO" } },
    update: {},
    create: {
      workspaceId: workspace.id,
      key: "DEMO",
      name: "Demo Project",
      description: "Starter demo project",
      members: { create: { userId: admin.id, role: ProjectRole.ADMIN } },
    },
  });

  console.log(
    existing
      ? `Seed complete. ${existing.email} already existed, so its password was not changed.`
      : `Seed complete. Sign in with: ${email} / ${password}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
