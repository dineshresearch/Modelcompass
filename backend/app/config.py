"""Environment-based configuration. The API key lives only here (backend/.env)."""
import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

INFERENCE_BASE_URL = os.getenv("INFERENCE_BASE_URL", "https://inference.do-ai.run/v1").rstrip("/")
INFERENCE_API_KEY = os.getenv("INFERENCE_API_KEY", "").strip()
REQUEST_TIMEOUT_S = float(os.getenv("REQUEST_TIMEOUT_S", "120"))
JUDGE_MODEL = os.getenv("JUDGE_MODEL", "glm-5.3-flash")
DB_PATH = BACKEND_DIR / "data" / "compass.db"

MODE = "live"  # demo mode removed — the PoC talks to the real endpoint only

# Cost / safety controls
MAX_TOKENS_DEFAULT = 4096
MAX_TOKENS_CAP = 8192
MAX_PROMPT_CHARS = 8000
MIN_MODELS = 2
MAX_MODELS = 4
MAX_CONCURRENCY = 4