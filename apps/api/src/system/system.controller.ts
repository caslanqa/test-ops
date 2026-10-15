import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiTags } from "@nestjs/swagger";
import { SystemInfoDto } from "./dto/system-info.dto";

@ApiTags("system")
@Controller("system")
export class SystemController {
  constructor(private readonly config: ConfigService) {}

  /**
   * Running version of this installation, with the API version. The version alone is also public in
   * GET /auth/config, for the sign-in screen.
   */
  @Get("info")
  info(): SystemInfoDto {
    return { version: this.config.get<string>("version", "dev"), apiVersion: "v1" };
  }
}
