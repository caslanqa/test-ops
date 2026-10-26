-- An invitation can carry a project and the role the person gets in it when they join, so one invitation
-- gives a workspace membership and a project role together. Existing invitations carry neither.
ALTER TABLE "workspace_invitations"
  ADD COLUMN "projectId" TEXT,
  ADD COLUMN "projectRole" "ProjectRole";

ALTER TABLE "workspace_invitations"
  ADD CONSTRAINT "workspace_invitations_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
