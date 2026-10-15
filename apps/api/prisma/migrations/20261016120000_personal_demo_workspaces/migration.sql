-- Every user gets a demo workspace of their own (DemoService), instead of one shared, read-only DEMO.
-- The shared one is removed when the app starts.

-- When the user's demo was made; it is made once, so a demo the user deleted doesn't come back unasked.
ALTER TABLE "users" ADD COLUMN "demoCreatedAt" TIMESTAMP(3);

-- The workspace is someone's demo, with the example shop project.
ALTER TABLE "workspaces" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
