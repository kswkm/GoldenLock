import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import * as dotenv from "dotenv";

import { MatchingService } from "./services/matchingService";
import { Relayer } from "./web3/relayer";
import { registerMatchSocket } from "./sockets/matchSocket";

dotenv.config();

const PORT = Number(process.env.PORT || 4000);
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
const GOLDEN_LOCK_ADDRESS = process.env.GOLDEN_LOCK_ADDRESS;
// 데모 기본값은 로컬 정적 서버(frontend/README.md 권장 포트)로 좁혀둔다.
// 콤마로 여러 origin을 지정할 수 있다: "https://a.example.com,https://b.example.com"
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!RELAYER_PRIVATE_KEY || !GOLDEN_LOCK_ADDRESS) {
  console.error(
    "[fatal] RELAYER_PRIVATE_KEY / GOLDEN_LOCK_ADDRESS 환경변수가 필요합니다. .env.example 참고."
  );
  process.exit(1);
}

const app = express();
app.use(cors({ origin: FRONTEND_ORIGINS }));
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: FRONTEND_ORIGINS },
});

const matchingService = new MatchingService();
const relayer = new Relayer(RPC_URL, RELAYER_PRIVATE_KEY, GOLDEN_LOCK_ADDRESS);

registerMatchSocket(io, matchingService, relayer);

// ── REST healthcheck / 디버그용 엔드포인트 ─────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", relayer: relayer.relayerAddress });
});

app.get("/hospitals", (_req, res) => {
  res.json(matchingService.listHospitals());
});

httpServer.listen(PORT, () => {
  console.log(`[relay-server] listening on :${PORT}`);
  console.log(`[relay-server] relayer address: ${relayer.relayerAddress}`);
  console.log(`[relay-server] GoldenLock contract: ${GOLDEN_LOCK_ADDRESS}`);
});
