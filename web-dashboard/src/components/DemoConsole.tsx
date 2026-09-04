"use client";

import { FormEvent, useEffect, useState } from "react";
import { useSocket } from "@/hooks/useSocket";
import { useZkProver } from "@/hooks/useZkProver";

type Props = { view: "ambulance" | "hospital" | "demo" };

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL || "http://localhost:4000";

async function login(username: string, password: string): Promise<string | undefined> {
  try {
    const response = await fetch(`${RELAY_URL}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
    if (!response.ok) return undefined;
    const result = await response.json() as { accessToken: string };
    return result.accessToken;
  } catch {
    return undefined;
  }
}

export function DemoConsole({ view }: Props) {
  // relay-server의 로컬 데모 계정(hospital/ambulance)으로 자동 로그인해 소켓 2개를 연다.
  // 실제 배포에서는 relay-server가 DATABASE_URL로 실행되어 이 계정이 존재하지 않으므로 자동 로그인은 조용히 실패한다.
  const [hospitalToken, setHospitalToken] = useState<string>();
  const [ambulanceToken, setAmbulanceToken] = useState<string>();
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    login("hospital", "hospital123").then(setHospitalToken);
    login("ambulance", "ambulance123").then((token) => {
      setAmbulanceToken(token);
      if (!token) setAuthError("로컬 데모 계정으로 로그인하지 못했습니다. relay-server가 DATABASE_URL 없이 실행 중인지 확인하세요.");
    });
  }, []);

  const { socket: hospitalSocket, connected: hospitalConnected } = useSocket(RELAY_URL, hospitalToken);
  const { socket: ambulanceSocket, connected: ambulanceConnected } = useSocket(RELAY_URL, ambulanceToken);
  const { createCapacityProof, signAvailability } = useZkProver();
  const [events, setEvents] = useState<string[]>([]);
  const [prediction, setPrediction] = useState<string>("");
  const add = (name: string, payload: unknown) => setEvents((items) => [`${new Date().toLocaleTimeString()}  ${name}\n${JSON.stringify(payload)}`, ...items].slice(0, 8));

  useEffect(() => {
    const client = ambulanceSocket.current;
    if (!client) return;
    const names = ["triage:completed", "match:found", "match:lock-requested", "match:lock-onchain", "match:lock-confirmed", "match:failed"];
    names.forEach((name) => client.on(name, (payload) => { add(name, payload); if (name === "triage:completed") setPrediction(`KTAS ${payload.ktas_grade} · ${payload.resource_code}`); }));
    return () => names.forEach((name) => client.off(name));
  }, [ambulanceSocket, ambulanceConnected]);

  useEffect(() => {
    const client = hospitalSocket.current;
    if (!client) return;
    client.on("hospital:capacity-request", async (request, acknowledge) => {
      const proof = await createCapacityProof();
      try {
        const signature = await signAvailability(request);
        acknowledge({ isAvailable: true, proof, nonce: request.nonce, signature });
      } catch {
        // MetaMask가 없는 로컬 데모 환경: 서명 없이 보내면 relay가 ALLOW_DEMO_PROOF 경로로 처리한다.
        acknowledge({ isAvailable: true, proof });
      }
      add("hospital:capacity-proof-sent", request);
    });
    return () => { client.off("hospital:capacity-request"); };
  }, [hospitalSocket, hospitalConnected, createCapacityProof, signAvailability]);

  const registerHospital = async () => {
    const ethereum = (window as Window & { ethereum?: { request: (args: { method: string }) => Promise<string[]> } }).ethereum;
    const accounts = ethereum ? await ethereum.request({ method: "eth_requestAccounts" }) : [];
    const hospitalAddress = accounts[0] || "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    hospitalSocket.current?.emit("hospital:join", "hospital-1");
    hospitalSocket.current?.emit("hospital:update-availability", {
      hospitalId: "hospital-1",
      hospitalAddress,
      resourceCode: 5,
      isAvailable: true,
      location: { lat: 37.5665, lng: 126.978 },
    });
  };
  const requestMatch = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); ambulanceSocket.current?.emit("ambulance:request-triage-match", { ambulanceId: "ambulance-1", ambulanceAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", patientCaseId: data.get("caseId"), location: { lat: 37.57, lng: 126.982 }, vitals: { ecg: [0.1, 0.2], spo2: [98, 97], hr: [82, 84] }, symptom_text: data.get("symptom"), meta: { age: Number(data.get("age")), sex: data.get("sex"), history: [] } }); };

  const connected = hospitalConnected && ambulanceConnected;

  if (authError) return <main className="shell"><section className="panel"><h1>GoldenLock</h1><p role="alert">{authError}</p></section></main>;

  return <main className="shell"><header className="mast"><div><h1>GoldenLock Control</h1><p>AI triage, hospital proof, and atomic resource reservation.</p></div><span className={`status ${connected ? "on" : ""}`}>{connected ? "RELAY CONNECTED" : "RELAY OFFLINE"}</span></header><nav className="tabs"><a className={view === "ambulance" ? "active" : ""} href="/ambulance">구급대</a><a className={view === "hospital" ? "active" : ""} href="/hospital">병원</a><a className={view === "demo" ? "active" : ""} href="/demo">통합 시연</a></nav><div className="grid">{view !== "hospital" && <section className="panel"><h2>구급대 요청</h2><form onSubmit={requestMatch}><div className="fields"><label className="field"><span>환자 케이스 ID</span><input name="caseId" defaultValue="case-001" required /></label><label className="field"><span>나이</span><input name="age" type="number" defaultValue="42" min="0" max="130" required /></label><label className="field"><span>성별</span><select name="sex"><option value="F">F</option><option value="M">M</option></select></label><label className="field span"><span>증상</span><input name="symptom" defaultValue="가벼운 복통" required /></label></div><div className="actions"><button type="submit">AI 분류 후 매칭</button></div></form>{prediction && <div className="result"><strong>AI 분류 완료</strong>{prediction}</div>}</section>}{view !== "ambulance" && <section className="panel"><h2>병원 수용 상태</h2><p className="note">병원은 자원 가용성을 relay에 등록하고, 수용 요청 시 브라우저에서 ZK 증명을 응답합니다.</p><div className="actions"><button onClick={registerHospital}>병원 등록 및 가용화</button><button className="secondary" onClick={() => hospitalSocket.current?.emit("hospital:confirm-acceptance", { matchId: "" })}>수용 확정</button></div></section>}<section className="panel"><h2>실시간 이벤트</h2><div className="event">{events.length ? events.join("\n\n") : "대기 중"}</div></section></div></main>;
}