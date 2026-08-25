package trace

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
)

// Encode writes compact JSON. Struct field order is declaration order and map
// keys are sorted by encoding/json, so the output is already canonical -- two
// runs over the same trace produce byte-identical bytes, which is what makes
// golden fixtures a usable regression suite.
func Encode(t *Trace) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(t); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// EncodePretty writes the golden-fixture form: one event per line, indented
// envelope. Committed goldens use this so a format change shows up as a
// readable git diff rather than one enormous line.
func EncodePretty(t *Trace) ([]byte, error) {
	meta, err := json.MarshalIndent(t.Meta, "  ", "  ")
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	fmt.Fprintf(&buf, "{\n  \"v\": %d,\n  \"meta\": %s,\n  \"events\": [\n", t.V, meta)
	for i := range t.Events {
		b, err := json.Marshal(&t.Events[i])
		if err != nil {
			return nil, err
		}
		buf.WriteString("    ")
		buf.Write(b)
		if i < len(t.Events)-1 {
			buf.WriteByte(',')
		}
		buf.WriteByte('\n')
	}
	buf.WriteString("  ]\n}\n")
	return buf.Bytes(), nil
}

// Decode parses and version-negotiates a trace. It never trusts its input.
func Decode(b []byte) (*Trace, error) {
	var probe struct {
		V int `json:"v"`
	}
	if err := json.Unmarshal(b, &probe); err != nil {
		return nil, fmt.Errorf("trace: not JSON: %w", err)
	}
	if probe.V > SupportedMax {
		return nil, fmt.Errorf("trace: version %d is newer than this build supports (max %d)", probe.V, SupportedMax)
	}
	if probe.V < SupportedMin {
		return Migrate(b, probe.V)
	}
	var t Trace
	dec := json.NewDecoder(bytes.NewReader(b))
	if err := dec.Decode(&t); err != nil {
		return nil, err
	}
	return &t, nil
}

// EncodeGzip returns compact JSON, gzipped. The server stores this form and
// serves it with Content-Encoding: gzip without recompressing.
func EncodeGzip(t *Trace) ([]byte, error) {
	raw, err := Encode(t)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	if _, err := zw.Write(raw); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// DecodeGzip is the inverse of EncodeGzip.
func DecodeGzip(b []byte) (*Trace, error) {
	zr, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	defer zr.Close()
	raw, err := io.ReadAll(zr)
	if err != nil {
		return nil, err
	}
	return Decode(raw)
}
