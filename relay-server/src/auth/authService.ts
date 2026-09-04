import bcrypt from "bcryptjs";
import Redis from "ioredis";
import { randomUUID } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { Pool } from "pg";
import { UserRole, AuthUser } from "../types";

const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || 900);

export class AuthService {
  private readonly redis: Redis;
  private readonly secret: Uint8Array;

  constructor(private readonly pool: Pool, redisUrl = process.env.REDIS_URL) {
    if (!redisUrl) throw new Error("REDIS_URL is required");
    if (!process.env.AUTH_JWT_SECRET || process.env.AUTH_JWT_SECRET.length < 32) {
      throw new Error("AUTH_JWT_SECRET must be at least 32 characters");
    }
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
    this.secret = new TextEncoder().encode(process.env.AUTH_JWT_SECRET);
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS app_users (
        user_id UUID PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('hospital', 'ambulance', 'operator')),
        organization_id TEXT NOT NULL,
        wallet_address TEXT,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  async login(username: string, password: string): Promise<{ accessToken: string; user: AuthUser }> {
    const result = await this.pool.query<{
      user_id: string; username: string; password_hash: string; role: UserRole; organization_id: string; wallet_address: string | null;
    }>("SELECT user_id, username, password_hash, role, organization_id, wallet_address FROM app_users WHERE username = $1 AND enabled = true", [username]);
    const record = result.rows[0];
    if (!record || !(await bcrypt.compare(password, record.password_hash))) throw new Error("invalid credentials");
    const user: AuthUser = { userId: record.user_id, username: record.username, role: record.role, organizationId: record.organization_id, walletAddress: record.wallet_address ?? undefined };
    const jti = randomUUID();
    const accessToken = await new SignJWT({ role: user.role, organizationId: user.organizationId, walletAddress: user.walletAddress })
      .setProtectedHeader({ alg: "HS256" }).setSubject(user.userId).setJti(jti).setIssuedAt().setExpirationTime(`${SESSION_TTL_SECONDS}s`).sign(this.secret);
    await this.redis.set(`session:${jti}`, JSON.stringify(user), "EX", SESSION_TTL_SECONDS);
    return { accessToken, user };
  }

  async authenticate(token: string): Promise<AuthUser> {
    const verified = await jwtVerify(token, this.secret, { algorithms: ["HS256"] });
    const jti = verified.payload.jti;
    if (!jti) throw new Error("session id missing");
    const session = await this.redis.get(`session:${jti}`);
    if (!session) throw new Error("session expired");
    return JSON.parse(session) as AuthUser;
  }

  async close(): Promise<void> { await this.redis.quit(); }
}
