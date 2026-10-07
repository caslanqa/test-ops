import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ProjectRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import { CreateMilestoneDto } from "./dto/create-milestone.dto";
import { UpdateMilestoneDto } from "./dto/update-milestone.dto";
import { ListMilestonesQueryDto } from "./dto/list-milestones-query.dto";
import { pageArgs } from "../common/pagination";

const WRITE_ROLES: ProjectRole[] = [ProjectRole.ADMIN, ProjectRole.TESTER];

@Injectable()
export class MilestonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
  ) {}

  async list(userId: string, projectId: string, query: ListMilestonesQueryDto) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    const where: Prisma.MilestoneWhereInput = {
      projectId,
      name: query.q ? { contains: query.q, mode: "insensitive" } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.milestone.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        ...pageArgs(query),
      }),
      this.prisma.milestone.count({ where }),
    ]);
    return { items, total };
  }

  async create(userId: string, projectId: string, dto: CreateMilestoneDto) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    return this.prisma.milestone.create({
      data: {
        projectId,
        name: dto.name,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });
  }

  async getOne(userId: string, projectId: string, milestoneId: string) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    const milestone = await this.prisma.milestone.findUnique({
      where: { id: milestoneId },
    });
    if (!milestone || milestone.projectId !== projectId) {
      throw new NotFoundException("Milestone not found");
    }
    return milestone;
  }

  async update(
    userId: string,
    projectId: string,
    milestoneId: string,
    dto: UpdateMilestoneDto,
  ) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.getOne(userId, projectId, milestoneId);
    return this.prisma.milestone.update({
      where: { id: milestoneId },
      data: {
        name: dto.name,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });
  }

  /** Plans and runs of the milestone are kept and simply lose the milestone. */
  async remove(userId: string, projectId: string, milestoneId: string) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.getOne(userId, projectId, milestoneId);
    await this.prisma.$transaction([
      this.prisma.testPlan.updateMany({
        where: { milestoneId },
        data: { milestoneId: null },
      }),
      this.prisma.testRun.updateMany({
        where: { milestoneId },
        data: { milestoneId: null },
      }),
      this.prisma.milestone.delete({ where: { id: milestoneId } }),
    ]);
  }
}
