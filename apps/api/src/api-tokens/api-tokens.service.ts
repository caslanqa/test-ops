import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { CreateApiTokenDto } from "./dto/create-api-token.dto";

// FR-073: API token’ları iptal edilebilir olmalı; oluşturma/son kullanım audit edilmelidir.
// Token sadece oluşturulduktan hemen sonra bir kez düz metin olarak döndürülür; sonrasında
// yalnızca hash saklanır ve tekrar gösterilmez.
@Injectable()
export class ApiTokensService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateApiTokenDto) {
    const plainToken = `tops_${crypto.randomBytes(32).toString("base64url")}`;
    const tokenHash = crypto
      .createHash("sha256")
      .update(plainToken)
      .digest("hex");
    const apiToken = await this.prisma.apiToken.create({
      data: { userId, name: dto.name, tokenHash },
    });
    return {
      id: apiToken.id,
      name: apiToken.name,
      token: plainToken, // yalnızca bu yanıtta görünür
      createdAt: apiToken.createdAt,
    };
  }

  async list(userId: string) {
    return this.prisma.apiToken.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async revoke(userId: string, tokenId: string) {
    const token = await this.prisma.apiToken.findUnique({
      where: { id: tokenId },
    });
    if (!token) throw new NotFoundException("Token not found");
    if (token.userId !== userId) {
      throw new ForbiddenException("This token does not belong to you");
    }
    // Yanıt tokenHash içermez; hash de olsa sızdırılmamalı.
    return this.prisma.apiToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
      select: { id: true, name: true, lastUsedAt: true, revokedAt: true, createdAt: true },
    });
  }
}
