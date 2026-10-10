import { Body, Controller, Get, HttpCode, Patch, Post } from "@nestjs/common";
import { ApiTags, ApiTooManyRequestsResponse } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { ChangePasswordDto, UpdateProfileDto } from "./dto/update-profile.dto";
import { Public } from "../common/decorators/public.decorator";
import { RateLimitAuthAttempt } from "../common/rate-limit";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../common/decorators/current-user.decorator";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get("config")
  config() {
    return this.authService.publicConfig();
  }

  @Public()
  @RateLimitAuthAttempt("login")
  @ApiTooManyRequestsResponse({ description: "Too many attempts; see the Retry-After header" })
  @HttpCode(200)
  @Post("login")
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @Public()
  @RateLimitAuthAttempt("register")
  @ApiTooManyRequestsResponse({ description: "Too many attempts; see the Retry-After header" })
  @Post("register")
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  @Patch("me")
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.id, dto.displayName);
  }

  /**
   * Changes the password and signs out every other session. The response carries a new session
   * token for the client that made the change; API tokens are not affected.
   */
  @RateLimitAuthAttempt("password-change")
  @ApiTooManyRequestsResponse({ description: "Too many attempts; see the Retry-After header" })
  @Patch("me/password")
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      user.id,
      user.authMethod,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
