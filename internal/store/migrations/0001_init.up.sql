-- Shares store a RECIPE, never a trace.
--
-- A trace is a pure function of (algo, input, seed, engine): the same four
-- values produce the same bytes on every machine, forever. So a row here is
-- ~120 bytes where the trace it reproduces may be a megabyte, and storing the
-- trace instead would be storing a cache entry inside a permalink.
--
-- `seed` is what makes this possible at all -- a "random 10-element array" is
-- generated from a recorded seed, so it replays identically. ADR 0007.
CREATE TABLE shares (
    id           TEXT PRIMARY KEY,          -- 6-char base32, collision-checked on insert
    algo         TEXT        NOT NULL,
    input        JSONB       NOT NULL,
    seed         BIGINT      NOT NULL DEFAULT 0,
    step         INTEGER     NOT NULL DEFAULT 0,
    lvl          SMALLINT    NOT NULL DEFAULT 0,

    -- engine at RECORD time. An engine change can alter the trace an old id
    -- resolves to; storing this lets the app say "recorded with 0.1.0, playing
    -- on 0.2.0" instead of silently drifting. BACKEND.md 2.3.
    engine       TEXT        NOT NULL,

    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    hits         BIGINT      NOT NULL DEFAULT 0
);
CREATE INDEX shares_last_seen_idx ON shares (last_seen_at);

-- The trace cache exists to save SERIALIZATION, not computation.
--
-- Generation is sub-millisecond; encoding and gzipping a 1MB N-Queens trace
-- costs more than producing it. That inverts the usual reason for a cache and
-- is why `body` is stored already gzipped: it is served straight out with
-- Content-Encoding: gzip, so TOAST's transparent compression would mean
-- decompressing on read only to recompress on write. BACKEND.md 6.
CREATE TABLE trace_cache (
    key         TEXT PRIMARY KEY,           -- sha256 hex over algo|input|seed|engine
    body        BYTEA       NOT NULL,       -- gzipped canonical JSON
    bytes       INTEGER     NOT NULL,
    algo        TEXT        NOT NULL,
    engine      TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_hit_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    hits        BIGINT      NOT NULL DEFAULT 0
);

-- Eviction is a cron over this index, not a trigger: a trigger would run inside
-- every insert's transaction to do work that has no deadline.
CREATE INDEX trace_cache_evict_idx ON trace_cache (last_hit_at);
