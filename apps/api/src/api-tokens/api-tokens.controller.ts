import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ApiTokensService } from "./api-tokens.service";
import { CreateApiTokenDto } from "./dto/create-api-token.dto";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../common/decorators/current-user.decorator";

@ApiTags("api-tokens")
@Controller("api-tokens")
export class ApiTokensController {
  constructor(private readonly apiTokensService: ApiTokensService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.apiTokensService.list(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateApiTokenDto,
  ) {
    return this.apiTokensService.create(user.id, dto);
  }

  @Delete(":tokenId")
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param("tokenId") tokenId: string,
  ) {
    return this.apiTokensService.revoke(user.id, tokenId);
  }
}
