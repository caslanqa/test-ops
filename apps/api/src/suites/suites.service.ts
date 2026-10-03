import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ProjectRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import { CreateSuiteDto } from "./dto/create-suite.dto";
import { UpdateSuiteDto } from "./dto/update-suite.dto";

const WRITE_ROLES: ProjectRole[] = [ProjectRole.ADMIN, ProjectRole.TESTER];

@Injectable()
export class SuitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
  ) {}

  async list(userId: string, projectId: string) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    return this.prisma.suite.findMany({
      where: { projectId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
  }

  async create(userId: string, projectId: string, dto: CreateSuiteDto) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.accessControl.assertSuiteInProject(projectId, dto.parentId);
    return this.prisma.suite.create({
      data: {
        projectId,
        name: dto.name,
        description: dto.description,
        parentId: dto.parentId,
      },
    });
  }

  async update(
    userId: string,
    projectId: string,
    suiteId: string,
    dto: UpdateSuiteDto,
  ) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.assertBelongsToProject(projectId, suiteId);
    if (dto.parentId) {
      await this.accessControl.assertSuiteInProject(projectId, dto.parentId);
      await this.assertNotDescendant(suiteId, dto.parentId);
    }
    return this.prisma.suite.update({ where: { id: suiteId }, data: dto });
  }

  async remove(userId: string, projectId: string, suiteId: string) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      [ProjectRole.ADMIN],
    );
    await this.assertBelongsToProject(projectId, suiteId);
    await this.prisma.suite.delete({ where: { id: suiteId } });
  }

  /** Moving a suite under itself or one of its child suites would create a cycle in the hierarchy. */
  private async assertNotDescendant(suiteId: string, newParentId: string) {
    let current: string | null = newParentId;
    while (current) {
      if (current === suiteId) {
        throw new BadRequestException(
          "A suite can't be moved under itself or one of its child suites",
        );
      }
      const parent: { parentId: string | null } | null =
        await this.prisma.suite.findUnique({
          where: { id: current },
          select: { parentId: true },
        });
      current = parent?.parentId ?? null;
    }
  }

  private async assertBelongsToProject(projectId: string, suiteId: string) {
    const suite = await this.prisma.suite.findUnique({
      where: { id: suiteId },
    });
    if (!suite || suite.projectId !== projectId) {
      throw new NotFoundException("Suite not found");
    }
    return suite;
  }
}
