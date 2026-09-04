import "dotenv/config";
import express from "express";
import cors from "cors";
import { ethers } from "ethers";
import { createServer } from "http";
import { Server } from "socket.io";

import { MatchingService } from "./services/matchingService";
import { Relayer } from "./web3/relayer";
import { registerMatchSocket } from "./sockets/matchSocket";
import { AuthService } from "./auth/authService";
import { LocalAuthService } from "./auth/localAuthService";
import { createDatabasePool, PostgresStore, MemoryStore } from "./storage/postgresStore";

const PORT = Number(process.env.PORT || 4000);
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
const GOLDEN_LOCK_ADDRESS = process.env.GOLDEN_LOCK_ADDRESS;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:3000").split(",").map((origin) => origin.trim());
// DATABASE_URL이 없으면 Postgres/Redis 없이 로컬에서 바로 실행 가능한 인메모리 인증/저장소를 쓴다.
const LOCAL_DEV_MODE = !process.env.DATABASE_URL;

if (LOCAL_DEV_MODE) {
  console.warn("[relay-server] DATABASE_URL not set -> using in-memory store + local demo accounts (hospital/ambulance/operator). Do not use in production.");
}

if (!RELAYER_PRIVATE_KEY || !GOLDEN_LOCK_ADDRESS || !ethers.isAddress(GOLDEN_LOCK_ADDRESS) || GOLDEN_LOCK_ADDRESS === ethers.ZeroAddress) {
  console.error(
    "[fatal] RELAYER_PRIVATE_KEY와 유효한 non-zero GOLDEN_LOCK_ADDRESS가 필요합니다. .env.example 참고."
  );
  process.exit(1);
}

if (process.env.NODE_ENV === "production" && (!process.env.RPC_URL || process.env.RPC_URL.startsWith("http://127.0.0.1"))) {
  console.error("[fatal] production relay requires a managed RPC_URL.");
  process.exit(1);
}

const app = express();
app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    allowedHeaders: ["Content-Type", "ngrok-skip-browser-warning"],
  })
);
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
    allowedHeaders: ["ngrok-skip-browser-warning", "content-type"],
  }, // 데모 환경: 필요 시 web-dashboard 도메인으로 제한
});

async function bootstrap() {
  const pool = LOCAL_DEV_MODE ? undefined : createDatabasePool();
  const store = pool ? new PostgresStore(pool) : new MemoryStore();
  const authService = pool ? new AuthService(pool) : new LocalAuthService();
  await store.initialize();
  await authService.initialize();
  const matchingService = new MatchingService(store);
  await matchingService.initialize();
  const relayer = new Relayer(RPC_URL, RELAYER_PRIVATE_KEY!, GOLDEN_LOCK_ADDRESS!);

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/ready", async (_req, res) => {
    try { await Promise.all([relayer.getBlockNumber(), store.ping()]); res.json({ status: "ready" }); }
    catch { res.status(503).json({ status: "not-ready" }); }
  });
  app.post("/auth/login", async (req, res) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) { res.status(400).json({ error: "username and password are required" }); return; }
    try { res.json(await authService.login(username, password)); }
    catch { res.status(401).json({ error: "invalid credentials" }); }
  });
  app.get("/hospitals", async (req, res) => {
    try { await authService.authenticate(readBearerToken(req)); res.json(matchingService.listHospitals()); }
    catch { res.status(401).json({ error: "unauthorized" }); }
  });

  io.use(async (socket, next) => {
    try {
      socket.data.user = await authService.authenticate(socket.handshake.auth?.token || readSocketBearerToken(socket.handshake.headers.authorization));
      next();
    } catch { next(new Error("unauthorized")); }
  });
  registerMatchSocket(io, matchingService, relayer);
  httpServer.listen(PORT, () => console.log(`[relay-server] listening on :${PORT}`));
}

function readBearerToken(req: express.Request): string {
  const value = req.header("authorization") || "";
  if (!value.startsWith("Bearer ")) throw new Error("missing bearer token");
  return value.slice(7);
}

function readSocketBearerToken(value: string | undefined): string {
  if (!value?.startsWith("Bearer ")) throw new Error("missing bearer token");
  return value.slice(7);
}

bootstrap().catch((error) => { console.error("[fatal] relay bootstrap failed", error); process.exit(1); });
