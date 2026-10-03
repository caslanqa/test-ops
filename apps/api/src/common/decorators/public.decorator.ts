import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

// Marks endpoints that need no auth, such as login, health/ready and the public run share link.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
