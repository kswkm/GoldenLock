"""
GoldenLock - ai-engine/main.py
FastAPI 구동 진입점 (flat 구조: ai-engine/ 루트 기준)
"""

from fastapi import FastAPI
from api.routes import router as ktas_router

app = FastAPI(
    title="GoldenLock AI Engine",
    description="온디바이스 KTAS 중증도 분류 API",
    version="0.1.0",
)

app.include_router(ktas_router, prefix="", tags=["KTAS"])


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "goldenlock-ai-engine"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
