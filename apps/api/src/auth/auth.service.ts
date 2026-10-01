import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { RegisterDto } from "./dto/register.dto";

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  /**
   * E-postayı büyük/küçük harf duyarsız arar: "Ali@x.com" ile kayıtlı kullanıcı
   * "ali@x.com" ile de giriş yapabilmeli ve aynı adres ikinci kez kaydedilmemeli.
   */
  findUserByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email: { equals: email.trim(), mode: "insensitive" } },
    });
  }

  /** Giriş ekranının kayıt bağlantısını gösterip göstermeyeceği. */
  publicConfig() {
    return {
      selfRegistration: this.config.get<boolean>("auth.selfRegistration") ?? false,
    };
  }

  async login(email: string, password: string) {
    const user = await this.findUserByEmail(email);
    if (!user || !user.isActive) {
      throw new UnauthorizedException("Invalid email or password");
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException("Invalid email or password");
    }
    return this.issueSession(user);
  }

  /**
   * Kendi kendine kayıt (SELF_REGISTRATION). Yeni kullanıcı hiçbir workspace'in
   * üyesi değildir: kendi workspace'ini oluşturabilir veya bir admin tarafından
   * eklenir; başka bir kapsamın verisini göremez.
   */
  async register(dto: RegisterDto) {
    if (!this.publicConfig().selfRegistration) {
      throw new ForbiddenException(
        "Self-registration is disabled on this server; your workspace admin creates your account.",
      );
    }
    if (await this.findUserByEmail(dto.email)) {
      throw new ConflictException("An account with this email already exists. Try signing in.");
    }
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.trim().toLowerCase(),
        displayName: dto.displayName.trim(),
        passwordHash: await this.hashPassword(dto.password),
      },
    });
    return this.issueSession(user);
  }

  async updateProfile(userId: string, displayName: string) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { displayName: displayName.trim() },
    });
    return { id: user.id, email: user.email, displayName: user.displayName };
  }

  /**
   * Parola değişikliği mevcut parolanın doğrulanmasını gerektirir; böylece açık
   * kalmış bir oturumu ele geçiren biri hesabı kalıcı olarak devralamaz.
   * API token'larıyla yapılamaz (token sahibinin parolasını değiştirmemeli).
   */
  async changePassword(
    userId: string,
    authMethod: "jwt" | "api-token",
    currentPassword: string,
    newPassword: string,
  ) {
    if (authMethod !== "jwt") {
      throw new ForbiddenException("The password can only be changed from a web session.");
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException("The current password is incorrect.");
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.hashPassword(newPassword) },
    });
  }

  private async issueSession(user: { id: string; email: string; displayName: string }) {
    const accessToken = await this.jwtService.signAsync({ sub: user.id });
    return {
      accessToken,
      user: { id: user.id, email: user.email, displayName: user.displayName },
    };
  }
}
