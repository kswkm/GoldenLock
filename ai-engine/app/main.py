"""GoldenLock AI engine FastAPI entry point."""

import os
from pathlib import Path

from fastapi import FastAPI
from app.api.routes import router as ktas_router

app = FastAPI(
    title="GoldenLock AI Engine",
    description="온디바이스 KTAS 중증도 분류 API",
    version="0.1.0",
)

app.include_router(ktas_router, prefix="", tags=["KTAS"])


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "goldenlock-ai-engine"}


@app.get("/ready")
def readiness_check():
    model_path = Path(__file__).parent / "models" / "ktas_classifier.onnx"
    fallback_allowed = os.getenv("ALLOW_RULE_BASED_FALLBACK", "false").lower() == "true"
    if not model_path.exists() and not fallback_allowed:
        from fastapi import HTTPException

        raise HTTPException(status_code=503, detail="AI model is not available")
    return {"status": "ready", "model": model_path.exists(), "fallback": fallback_allowed}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000)
