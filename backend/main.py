"""GoldenLock backend API entry point."""

from fastapi import FastAPI

from api.ai import router as ai_router

app = FastAPI(
    title="GoldenLock Backend",
    description="GoldenLock backend API gateway",
    version="0.1.0",
)

app.include_router(ai_router)


@app.get("/", include_in_schema=False)
def service_info():
    return {"service": "goldenlock-backend", "status": "ok"}


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "goldenlock-backend"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=5000)