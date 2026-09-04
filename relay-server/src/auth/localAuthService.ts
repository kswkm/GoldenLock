import { randomUUID } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { AuthUser, UserRole } from "../types";

/**
 * DATABASE_URL/REDIS_URL 없이 로컬에서 바로 실행하기 위한 인증 서비스.
 * 고정된 데모 계정만 지원하며, 세션은 프로세스 메모리에 저장된다 (운영 사용 금지).
 */
const DEMO_USERS: Record<string, { password: string; user: AuthUser }> = {
  hospital: {
    password: "hospital123",
    user: { userId: "local-hospital", username: "hospital", role: "hospital" as UserRole, organizationId: "hospital-1", walletAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" },
  },
  ambulance: {
    password: "ambulance123",
    user: { userId: "local-ambulance", username: "ambulance", role: "ambulance" as UserRole, organizationId: "ambulance-1", walletAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" },
  },
  operator: {
    password: "operator123",
    user: { userId: "local-operator", username: "operator", role: "operator" as UserRole, organizationId: "ops" },
  },
};

export class LocalAuthService {
  private readonly secret: Uint8Array;
  private readonly sessions = new Map<string, AuthUser>();

  constructor(secret = process.env.AUTH_JWT_SECRET || "local-development-only-secret-change-me-32chars") {
    this.secret = new TextEncoder().encode(secret);
  }

  async initialize(): Promise<void> {}

  async login(username: string, password: string): Promise<{ accessToken: string; user: AuthUser }> {
    const record = DEMO_USERS[username];
    if (!record || record.password !== password) throw new Error("invalid credentials");
    const jti = randomUUID();
    this.sessions.set(jti, record.user);
    const accessToken = await new SignJWT({ role: record.user.role, organizationId: record.user.organizationId, walletAddress: record.user.walletAddress })
      .setProtectedHeader({ alg: "HS256" }).setSubject(record.user.userId).setJti(jti).setIssuedAt().setExpirationTime("12h").sign(this.secret);
    return { accessToken, user: record.user };
  }

  async authenticate(token: string): Promise<AuthUser> {
    const verified = await jwtVerify(token, this.secret, { algorithms: ["HS256"] });
    const jti = verified.payload.jti;
    if (!jti) throw new Error("session id missing");
    const session = this.sessions.get(jti);
    if (!session) throw new Error("session expired");
    return session;
  }

  async close(): Promise<void> {}
}
