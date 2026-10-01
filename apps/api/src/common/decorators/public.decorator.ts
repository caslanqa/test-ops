import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

// Login, health/ready ve public run paylaşım linki gibi auth gerektirmeyen endpoint'leri işaretler.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
