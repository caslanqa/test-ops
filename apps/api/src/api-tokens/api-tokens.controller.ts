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

  /** Your API tokens, without their values. Needs a signed-in web session, not an API token. */
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.apiTokensService.list(user);
  }

  /**
   * Creates an API token; its value is returned only in this response. Needs a signed-in web
   * session, not an API token.
   */
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateApiTokenDto,
  ) {
    return this.apiTokensService.create(user, dto);
  }

  /** Revokes an API token at once. Needs a signed-in web session, not an API token. */
  @Delete(":tokenId")
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param("tokenId") tokenId: string,
  ) {
    return this.apiTokensService.revoke(user, tokenId);
  }
}
