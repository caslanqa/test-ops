import { Global, Module } from "@nestjs/common";
import { AttachmentFilesService } from "./attachment-files.service";

/** Global so services that delete attachment-owning records can clean up files without wiring. */
@Global()
@Module({
  providers: [AttachmentFilesService],
  exports: [AttachmentFilesService],
})
export class AttachmentFilesModule {}
