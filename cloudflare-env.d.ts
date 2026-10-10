declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    OBSERVER_URL?: string;
    OBSERVER_TOKEN?: string;
    OBSERVER_MODEL?: string;
    OBSERVER_ALLOW_LOCAL?: string;
    OBSERVER_TIMEOUT_MS?: string;
  }
}
