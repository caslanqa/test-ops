import { Controller, Get, Param } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RunsService } from "./runs.service";
import { Public } from "../common/decorators/public.decorator";

// FR-063: auth-exempt (no auth required) run share view behind an unguessable token
@ApiTags("public")
@Controller("public/runs")
export class PublicRunsController {
  constructor(private readonly runsService: RunsService) {}

  @Public()
  @Get(":token")
  getPublicView(@Param("token") token: string) {
    return this.runsService.getPublicView(token);
  }
}
