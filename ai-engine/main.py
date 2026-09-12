"""
GoldenLock - ai-engine/main.py
FastAPI 구동 진입점 (flat 구조: ai-engine/ 루트 기준)
"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router as ktas_router

app = FastAPI(
    title="GoldenLock AI Engine",
    description="온디바이스 KTAS 중증도 분류 API",
    version="0.1.0",
)

# frontend(정적 콘솔)가 브라우저에서 직접 이 API를 호출하므로 CORS 허용이 필요하다.
# 기본값은 frontend/README.md가 권장하는 로컬 정적 서버 포트. 콤마로 여러 origin 지정 가능.
_frontend_origins = [
    origin.strip()
    for origin in os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_frontend_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ktas_router, prefix="", tags=["KTAS"])


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "goldenlock-ai-engine"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
