-- name: GetCachedTrace :one
-- Same single-statement read-and-bump as GetShare, for the same reason:
-- last_hit_at drives eviction, so an unbumped hit is a row that looks colder
-- than it is and gets deleted while in use.
UPDATE trace_cache
   SET hits = hits + 1, last_hit_at = now()
 WHERE key = $1
RETURNING key, body, bytes, algo, engine;

-- name: PutCachedTrace :exec
-- ON CONFLICT DO NOTHING, not DO UPDATE: the key is a content hash over
-- (algo, input, seed, engine), so a row that already exists holds the same
-- bytes by construction. An UPDATE would rewrite a megabyte to store what is
-- already there, and two concurrent generations of the same trace would fight.
INSERT INTO trace_cache (key, body, bytes, algo, engine)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (key) DO NOTHING;

-- name: EvictColdTraces :execrows
DELETE FROM trace_cache WHERE last_hit_at < $1;
