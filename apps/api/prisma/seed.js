// Geliştirme ortamı için başlangıç verisi: ilk admin kullanıcı + örnek workspace/project.
// Çalıştırmak için: node prisma/seed.js  (veya docker compose exec api node prisma/seed.js)
const { PrismaClient, WorkspaceRole, ProjectRole } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@testops.local";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      displayName: "Workspace Admin",
      passwordHash: await bcrypt.hash(password, 12),
    },
  });

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
      description: "Başlangıç örnek projesi",
      members: { create: { userId: admin.id, role: ProjectRole.ADMIN } },
    },
  });

  console.log(`Seed tamamlandı. Giriş bilgileri: ${email} / ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
