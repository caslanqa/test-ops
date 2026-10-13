import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { CreateApiTokenDto } from "./dto/create-api-token.dto";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Lifetime of a token when the request doesn't say; the Account page offers the same. */
const DEFAULT_LIFETIME_DAYS = 90;

/** The token fields a client may see; the hash is never returned. */
const PUBLIC_FIELDS = {
  id: true,
  name: true,
  lastUsedAt: true,
  revokedAt: true,
  expiresAt: true,
  createdAt: true,
} as const;

// FR-073: API tokens must be revocable; creation/last use must be audited.
// The token is returned in plain text only once, right after creation; after that
// only the hash is stored and it is never shown again.
@Injectable()
export class ApiTokensService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: AuthenticatedUser, dto: CreateApiTokenDto) {
    const plainToken = `tops_${crypto.randomBytes(32).toString("base64url")}`;
    const tokenHash = crypto
      .createHash("sha256")
      .update(plainToken)
      .digest("hex");
    const apiToken = await this.prisma.$transaction(async (tx) => {
      // A password change revokes every token and bumps sessionVersion under the user row lock.
      // Holding a share lock on that row and re-checking the version means a session that a
      // concurrent password change just ended can't slip a new token in after the revocation.
      const [row] = await tx.$queryRaw<{ sessionVersion: number }[]>`
        SELECT "sessionVersion" FROM users WHERE id = ${user.id} FOR SHARE`;
      if (!row || row.sessionVersion !== user.sessionVersion) {
        throw new UnauthorizedException("Your session has ended; sign in again.");
      }
      return tx.apiToken.create({
        data: {
          userId: user.id,
          name: dto.name,
          tokenHash,
          // Omitted: the default lifetime. An explicit null: no expiration.
          expiresAt:
            dto.expiresInDays === null
              ? null
              : new Date(
                  Date.now() + (dto.expiresInDays ?? DEFAULT_LIFETIME_DAYS) * DAY_MS,
                ),
        },
      });
    });
    return {
      id: apiToken.id,
      name: apiToken.name,
      token: plainToken, // visible only in this response
      expiresAt: apiToken.expiresAt,
      createdAt: apiToken.createdAt,
    };
  }

  async list(user: AuthenticatedUser) {
    return this.prisma.apiToken.findMany({
      where: { userId: user.id },
      select: PUBLIC_FIELDS,
      orderBy: { createdAt: "desc" },
    });
  }

  async revoke(user: AuthenticatedUser, tokenId: string) {
    const token = await this.prisma.apiToken.findUnique({
      where: { id: tokenId },
    });
    if (!token) throw new NotFoundException("Token not found");
    if (token.userId !== user.id) {
      throw new ForbiddenException("This token does not belong to you");
    }
    // The response omits tokenHash; even a hash must not leak.
    return this.prisma.apiToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
      select: PUBLIC_FIELDS,
    });
  }
}
