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
import { DefectsService } from "./defects.service";
import { CreateDefectDto } from "./dto/create-defect.dto";
import { UpdateDefectDto } from "./dto/update-defect.dto";
import { LinkResultsDto } from "./dto/link-results.dto";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../common/decorators/current-user.decorator";

@ApiTags("defects")
@Controller("projects/:projectId/defects")
export class DefectsController {
  constructor(private readonly defectsService: DefectsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ) {
    return this.defectsService.list(user.id, projectId);
  }

  @Get(":defectId")
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("defectId") defectId: string,
  ) {
    return this.defectsService.getOne(user.id, projectId, defectId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() dto: CreateDefectDto,
  ) {
    return this.defectsService.create(user.id, projectId, dto);
  }

  @Patch(":defectId")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("defectId") defectId: string,
    @Body() dto: UpdateDefectDto,
  ) {
    return this.defectsService.update(user.id, projectId, defectId, dto);
  }

  @Post(":defectId/results")
  linkResults(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("defectId") defectId: string,
    @Body() dto: LinkResultsDto,
  ) {
    return this.defectsService.linkResults(
      user.id,
      projectId,
      defectId,
      dto.resultIds,
    );
  }

  @Delete(":defectId/results/:resultId")
  unlinkResult(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("defectId") defectId: string,
    @Param("resultId") resultId: string,
  ) {
    return this.defectsService.unlinkResult(
      user.id,
      projectId,
      defectId,
      resultId,
    );
  }
}
