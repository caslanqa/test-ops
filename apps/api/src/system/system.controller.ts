import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiTags } from "@nestjs/swagger";
import { SystemInfoDto } from "./dto/system-info.dto";

@ApiTags("system")
@Controller("system")
export class SystemController {
  constructor(private readonly config: ConfigService) {}

  /**
   * Running version of this installation
   *
   * Requires sign-in on purpose: the exact version would tell an anonymous visitor
   * which known issues apply to this server.
   */
  @Get("info")
  info(): SystemInfoDto {
    return { version: this.config.get<string>("version", "dev"), apiVersion: "v1" };
  }
}
