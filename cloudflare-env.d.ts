declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    PLANNER_PROVIDER?: string;
    GEMINI_API_KEY?: string;
    GEMINI_MODEL?: string;
    MODEL_CONNECTION_SECRET?: string;
    TINYFISH_API_KEY?: string;
    OBSERVER_URL?: string;
    OBSERVER_TOKEN?: string;
    OBSERVER_MODEL?: string;
    OBSERVER_ALLOW_LOCAL?: string;
    OBSERVER_TIMEOUT_MS?: string;
  }
}
