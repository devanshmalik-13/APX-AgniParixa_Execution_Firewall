import hmac
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from .contracts import HealthResponse, ObserveRequest, ObservationResponse
from .engine import ModelMismatch, ObserverBusy
from .loader import load_engine
from .registry import THRESHOLD
from .settings import Settings

MAX_BODY_BYTES = 64 * 1024


def create_app(settings=None, engine_factory=load_engine):
    settings = settings or Settings.from_environment()

    @asynccontextmanager
    async def lifespan(app):
        app.state.engine = await run_in_threadpool(engine_factory, settings)
        yield
        app.state.engine = None

    app = FastAPI(
        title="APX shadow observer", lifespan=lifespan,
        docs_url=None, redoc_url=None, openapi_url=None,
    )

    def authorize(request):
        authorization = request.headers.get("authorization", "")
        supplied = authorization[7:] if authorization.startswith("Bearer ") else ""
        if not hmac.compare_digest(supplied.encode(), settings.token.encode()):
            raise HTTPException(401, "Observer authentication required.")

    @app.get("/health", response_model=HealthResponse)
    async def health(request: Request):
        authorize(request)
        return {
            "schemaVersion": 1, "status": "ready", "model": request.app.state.engine.identity,
            "windowTokens": 512, "overlapTokens": 64, "threshold": THRESHOLD,
        }

    @app.post("/v1/observe", response_model=ObservationResponse)
    async def observe(request: Request):
        authorize(request)
        content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            raise HTTPException(415, "Only application/json is supported.")
        raw = bytearray()
        async for part in request.stream():
            raw.extend(part)
            if len(raw) > MAX_BODY_BYTES:
                raise HTTPException(413, "The observer request body limit was exceeded.")
        try:
            payload = ObserveRequest.model_validate_json(raw)
        except ValidationError:
            # Validation errors can contain raw input. Return a fixed public message.
            raise HTTPException(422, "Invalid observer request; check input types and documented limits.") from None
        try:
            return await run_in_threadpool(request.app.state.engine.observe, payload.texts, payload.modelKey)
        except ModelMismatch:
            raise HTTPException(409, "The requested model is not loaded in this service instance.") from None
        except ObserverBusy:
            raise HTTPException(503, "The observer is busy; retry later.", headers={"Retry-After": "1"}) from None
        except Exception:
            # No request text or arbitrary model exceptions enter the response/log.
            raise HTTPException(503, "Observer inference failed; no security conclusion is available.") from None

    return app
