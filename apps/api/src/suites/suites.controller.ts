import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { SuitesService } from "./suites.service";
import { CreateSuiteDto } from "./dto/create-suite.dto";
import { UpdateSuiteDto } from "./dto/update-suite.dto";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../common/decorators/current-user.decorator";

@ApiTags("suites")
@Controller("projects/:projectId/suites")
export class SuitesController {
  constructor(private readonly suitesService: SuitesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ) {
    return this.suitesService.list(user.id, projectId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() dto: CreateSuiteDto,
  ) {
    return this.suitesService.create(user.id, projectId, dto);
  }

  @Patch(":suiteId")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("suiteId") suiteId: string,
    @Body() dto: UpdateSuiteDto,
  ) {
    return this.suitesService.update(user.id, projectId, suiteId, dto);
  }

  @Delete(":suiteId")
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("suiteId") suiteId: string,
  ) {
    return this.suitesService.remove(user.id, projectId, suiteId);
  }
}
