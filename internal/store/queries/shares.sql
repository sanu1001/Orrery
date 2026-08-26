-- name: CreateShare :exec
INSERT INTO shares (id, algo, input, seed, step, lvl, engine)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: GetShare :one
-- Resolving a share bumps its counters in the same statement. Two round trips
-- would let a read succeed and its bookkeeping fail, and then "hits" quietly
-- undercounts exactly the links that are being shared most.
UPDATE shares
   SET hits = hits + 1, last_seen_at = now()
 WHERE id = $1
RETURNING id, algo, input, seed, step, lvl, engine, created_at;
