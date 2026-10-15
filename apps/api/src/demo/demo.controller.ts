import { Controller, Get, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuthenticatedUser, CurrentUser } from "../common/decorators/current-user.decorator";
import { DemoService } from "./demo.service";

/**
 * The caller's own demo workspace. Its own path rather than /workspaces/demo, which would be read
 * as the workspace with the id "demo".
 */
@ApiTags("workspaces")
@Controller("demo-workspace")
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  /** Whether this server makes demo workspaces, and the caller's current one (null once deleted). */
  @Get()
  async status(@CurrentUser() user: AuthenticatedUser) {
    const current = this.demo.enabled ? await this.demo.currentDemo(user.id) : null;
    return { enabled: this.demo.enabled, workspaceId: current?.id ?? null };
  }

  /** Makes a fresh demo workspace for a caller who deleted theirs; 409 while they still have one. */
  @Post()
  create(@CurrentUser() user: AuthenticatedUser) {
    return this.demo.recreate(user.id);
  }
}
