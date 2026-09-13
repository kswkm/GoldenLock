"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const dotenv = __importStar(require("dotenv"));
const matchingService_1 = require("./services/matchingService");
const relayer_1 = require("./web3/relayer");
const matchSocket_1 = require("./sockets/matchSocket");
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
    console.error("[fatal] RELAYER_PRIVATE_KEY / GOLDEN_LOCK_ADDRESS 환경변수가 필요합니다. .env.example 참고.");
    process.exit(1);
}
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: FRONTEND_ORIGINS }));
app.use(express_1.default.json());
const httpServer = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(httpServer, {
    cors: { origin: FRONTEND_ORIGINS },
});
const matchingService = new matchingService_1.MatchingService();
const relayer = new relayer_1.Relayer(RPC_URL, RELAYER_PRIVATE_KEY, GOLDEN_LOCK_ADDRESS);
(0, matchSocket_1.registerMatchSocket)(io, matchingService, relayer);
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
