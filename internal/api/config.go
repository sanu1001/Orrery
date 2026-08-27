package api

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"strings"
	"time"
)

// Config is the whole server configuration, read once at startup.
//
// Environment variables, not a config file and not Viper. The deployment target
// is a single container whose orchestrator already speaks env vars; a config
// file would be a second source of truth that has to be baked into the image or
// mounted, and the failure mode of "the file was not mounted" is worse than
// "the variable was not set", because the second one is loud.
type Config struct {
	Addr        string // listen address, default :8080
	DatabaseURL string // required: postgres://...
	Env         string // dev | prod

	// CORSOrigins is exact-match only, never a wildcard. The frontend is served
	// from a known static host (netlify.toml), so the set is small and knowable,
	// and "*" on an API that writes rows is a habit worth not forming.
	CORSOrigins []string

	// TraceDeadline caps one generation. Hitting it is not an error -- the
	// tracer marks the trace truncated and the user sees how far an exponential
	// algorithm got, which is the lesson. BACKEND.md 2.1, ADR 0014.
	TraceDeadline time.Duration

	// TrustedProxies are the CIDRs of our own infrastructure. EMPTY MEANS
	// "ignore X-Forwarded-For entirely", which is the safe default: a server
	// reached directly sees the real peer in RemoteAddr, and honouring a
	// forwarded header nobody stripped means honouring one anybody can send.
	// See clientIP in ratelimit.go for how the list is used.
	TrustedProxies []*net.IPNet

	// IPSalt salts the hash that goes in the request log. A random salt per
	// process is the default and it is the right one: it makes a single log
	// file correlatable within a run and useless afterwards, which is exactly
	// as much as this project has any business retaining. Set it explicitly
	// only if correlation ACROSS restarts is genuinely wanted.
	IPSalt string
}

// Stage B adds CompileWorkers, CompileQueue, CompileTimeout, ArtifactDir and
// EnableStageB here (BACKEND.md 8). They are deliberately absent until the
// compile path exists: config that nothing reads is config nobody maintains,
// and it reads as a half-built feature rather than an unbuilt one.

// Load reads the environment and validates it. It returns every problem it
// finds rather than the first, because a misconfigured deploy is usually
// misconfigured in more than one way and one-at-a-time is a slow loop.
func Load() (Config, error) {
	c := Config{
		Addr:          env("ORRERY_ADDR", ":8080"),
		DatabaseURL:   os.Getenv("DATABASE_URL"),
		Env:           env("ORRERY_ENV", "dev"),
		TraceDeadline: 5 * time.Second,
		IPSalt:        env("ORRERY_IP_SALT", randomSalt()),
	}
	if o := os.Getenv("ORRERY_CORS_ORIGINS"); o != "" {
		for _, s := range strings.Split(o, ",") {
			if s = strings.TrimSpace(s); s != "" {
				c.CORSOrigins = append(c.CORSOrigins, s)
			}
		}
	}
	if d := os.Getenv("ORRERY_TRACE_DEADLINE"); d != "" {
		v, err := time.ParseDuration(d)
		if err != nil {
			return c, fmt.Errorf("ORRERY_TRACE_DEADLINE: %q is not a duration", d)
		}
		c.TraceDeadline = v
	}

	if p := os.Getenv("ORRERY_TRUSTED_PROXIES"); p != "" {
		for _, raw := range strings.Split(p, ",") {
			raw = strings.TrimSpace(raw)
			if raw == "" {
				continue
			}
			// A bare address is accepted as a /32 or /128, because "the proxy is
			// at 10.0.0.7" is how people think about it and demanding a mask
			// for one host is the kind of friction that gets worked around by
			// widening the range instead.
			if !strings.Contains(raw, "/") {
				if ip := net.ParseIP(raw); ip != nil {
					bits := 32
					if ip.To4() == nil {
						bits = 128
					}
					raw = fmt.Sprintf("%s/%d", raw, bits)
				}
			}
			_, n, err := net.ParseCIDR(raw)
			if err != nil {
				return c, fmt.Errorf("ORRERY_TRUSTED_PROXIES: %q is not an address or CIDR", raw)
			}
			c.TrustedProxies = append(c.TrustedProxies, n)
		}
	}

	var bad []string
	if c.DatabaseURL == "" {
		bad = append(bad, "DATABASE_URL is required")
	}
	if c.Env != "dev" && c.Env != "prod" {
		bad = append(bad, fmt.Sprintf("ORRERY_ENV is %q, want dev or prod", c.Env))
	}
	if c.Env == "prod" && len(c.CORSOrigins) == 0 {
		// In dev the frontend is on localhost:5173 and the allowance is
		// automatic; in prod an empty list means every browser request fails
		// CORS, which presents as "the site is broken" with nothing in the log.
		bad = append(bad, "ORRERY_CORS_ORIGINS is required when ORRERY_ENV=prod")
	}
	if len(bad) > 0 {
		return c, fmt.Errorf("config: %s", strings.Join(bad, "; "))
	}
	return c, nil
}

// Redacted renders the config for the startup log with the database password
// removed. Logging the config is worth doing -- most deploy incidents are a
// variable that was not what someone thought -- but a password in a log line
// outlives the incident it was meant to help with.
func (c Config) Redacted() string {
	proxies := make([]string, 0, len(c.TrustedProxies))
	for _, n := range c.TrustedProxies {
		proxies = append(proxies, n.String())
	}
	// The salt is not printed. It is the only reason the hashed IPs in the log
	// are not reversible by anyone holding the log.
	return fmt.Sprintf("addr=%s env=%s db=%s cors=%v traceDeadline=%s trustedProxies=%v",
		c.Addr, c.Env, redactURL(c.DatabaseURL), c.CORSOrigins, c.TraceDeadline, proxies)
}

// randomSalt is 16 bytes from crypto/rand. It cannot fail in practice, and if
// the platform's entropy source is genuinely broken then a server that refuses
// to start is the correct outcome rather than one that logs correlatable IPs.
func randomSalt() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic("api: no entropy for the IP log salt: " + err.Error())
	}
	return hex.EncodeToString(b)
}

// redactURL blanks the password in a postgres URL without parsing it as a URL.
// net/url.Parse rejects some legal libpq strings (a bare "host=... user=..."
// keyword string is not a URL at all), and a redactor that errors on the input
// it is handed just moves the problem.
func redactURL(s string) string {
	at := strings.LastIndex(s, "@")
	if at < 0 {
		return s
	}
	scheme := strings.Index(s, "://")
	if scheme < 0 {
		return s
	}
	creds := s[scheme+3 : at]
	if colon := strings.Index(creds, ":"); colon >= 0 {
		return s[:scheme+3] + creds[:colon] + ":****" + s[at:]
	}
	return s
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
