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

if (!RELAYER_PRIVATE_KEY || !GOLDEN_LOCK_ADDRESS) {
  console.error(
    "[fatal] RELAYER_PRIVATE_KEY / GOLDEN_LOCK_ADDRESS 환경변수가 필요합니다. .env.example 참고."
  );
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }, // 데모 환경: 필요 시 web-dashboard 도메인으로 제한
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
