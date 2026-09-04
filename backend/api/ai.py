import httpx
import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(
    prefix="/api/ai",
    tags=["AI"]
)


AI_ENGINE_URL = os.getenv(
    "AI_ENGINE_URL",
    "http://localhost:8000"
)


class AIRequest(BaseModel):
    vitals: dict
    symptom_text: str = Field(min_length=1)
    meta: dict


@router.post("/predict-ktas")
async def predict_ktas(request: AIRequest):

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:

            response = await client.post(
                f"{AI_ENGINE_URL}/predict-ktas",
                json=request.model_dump(),
            )

            response.raise_for_status()

            return response.json()

    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail="AI Engine 응답 시간 초과"
        )

    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=502,
            detail=f"AI Engine 오류: {e.response.text}"
        )

    except httpx.RequestError as e:
        raise HTTPException(
            status_code=502,
            detail=f"AI Engine 연결 실패: {str(e)}"
        )