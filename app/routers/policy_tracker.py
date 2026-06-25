from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.policy_trigger import PolicyTriggerEvent
from app.services.policy_tracker import evaluate_all, evaluate_one, upsert_state
from app.time_util import now_ist

router = APIRouter(prefix="/api/v1/policy-tracker", tags=["policy-tracker"])


class TriggerStateUpdate(BaseModel):
    value_bool: bool | None = None
    value_text: str | None = None
    value_num: float | None = None


@router.get("")
async def get_policy_tracker(db: AsyncSession = Depends(get_db)):
    data = await evaluate_all(db)
    return JSONResponse(data)


@router.put("/state/{key}")
async def set_trigger_state(key: str, body: TriggerStateUpdate, db: AsyncSession = Depends(get_db)):
    await upsert_state(db, key,
                       value_bool=body.value_bool,
                       value_text=body.value_text,
                       value_num=body.value_num)
    result = await evaluate_one(db, key)
    db.add(PolicyTriggerEvent(
        trigger_key=key,
        status=result["status"] if result else "manual",
        detail=result or {},
        created_at=now_ist(),
    ))
    await db.commit()
    return JSONResponse(result)
