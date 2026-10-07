import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  AutomationStatus,
  CasePriority,
  CaseSeverity,
  CaseType,
  DefectSeverity,
  DefectStatus,
  ProjectRole,
  ResultSource,
  ResultStatus,
  RunStatus,
  WorkspaceRole,
} from "@prisma/client";

/**
 * The fixed values that fields accept, so API clients and generated forms don't hard-code
 * them. They come straight from the database enums and therefore never go out of date.
 */
@ApiTags("system-fields")
@Controller("system-fields")
export class SystemFieldsController {
  @Get()
  list() {
    const values = (e: Record<string, string>) => Object.values(e);
    return {
      testCase: {
        priority: values(CasePriority),
        severity: values(CaseSeverity),
        type: values(CaseType),
        automationStatus: values(AutomationStatus),
      },
      result: { status: values(ResultStatus), source: values(ResultSource) },
      run: { status: values(RunStatus) },
      defect: { status: values(DefectStatus), severity: values(DefectSeverity) },
      roles: { project: values(ProjectRole), workspace: values(WorkspaceRole) },
    };
  }
}
