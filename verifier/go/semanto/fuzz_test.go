// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Trooth, LLC
//
// Fuzz tests for everything the verifier reads from the network: the signed file, response signature headers, the
// Content-Digest header, compact JWS strings, log checkpoints and inclusion proofs. Each must answer (ok or a reason)
// and never panic, whatever the bytes. The seeds are the shared test vectors.
//
//	go test ./semanto/ -run=^$ -fuzz=FuzzVerifySemanto -fuzztime=30s
package semanto

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func seedFile(f *testing.F, name string) []byte {
	f.Helper()
	b, err := os.ReadFile(filepath.Join(vectorDir, name))
	if err != nil {
		f.Fatalf("read %s: %v", name, err)
	}
	return b
}

func fuzzKeys(f *testing.F) KeySet {
	f.Helper()
	var k map[string]any
	if err := DecodeJSON(seedFile(f, "keys.json"), &k); err != nil {
		f.Fatalf("keys: %v", err)
	}
	return CollectKeys(k)
}

var fuzzNow = time.Date(2026, 10, 22, 12, 0, 10, 0, time.UTC)

func FuzzVerifySemanto(f *testing.F) {
	keys := fuzzKeys(f)
	var v map[string]any
	if err := DecodeJSON(seedFile(f, "semanto.json"), &v); err != nil {
		f.Fatalf("semanto.json: %v", err)
	}
	if b, err := CanonicalBytes(v["file"]); err == nil {
		f.Add(b)
	}
	f.Add([]byte(`{"header":{}}`))
	f.Add([]byte(`{}`))
	f.Fuzz(func(t *testing.T, data []byte) {
		var file map[string]any
		if DecodeJSON(data, &file) != nil {
			return
		}
		r := VerifySemanto(file, map[string][]byte{}, keys, fuzzNow, nil)
		if !r.OK && r.Reason == "" {
			t.Fatalf("a refusal without a reason")
		}
	})
}

func FuzzParseSignatureHeaders(f *testing.F) {
	f.Add(`sig1=("@status" "content-type" "content-digest");created=1729598400;keyid="abc";alg="ed25519";tag="trooth-semanto"`, `sig1=:AAAA:`)
	f.Add(`sig1=();created=-1`, `sig1=:%%%:`)
	f.Add(``, ``)
	// A parameter whose value is a lone quote once panicked (slice bounds out of range [1:0]).
	f.Add(`sig1=("@status");created=1729598400;keyid="abc";tag="`, ``)
	f.Fuzz(func(t *testing.T, input, sig string) {
		_ = ParseSignatureInput(input)
		_ = ParseSignature(sig)
	})
}

func FuzzVerifyContentDigest(f *testing.F) {
	f.Add(`sha-256=:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=:`, []byte(""))
	f.Add(`sha-512=:AAAA:, sha-256=:BBBB:`, []byte("body"))
	f.Fuzz(func(t *testing.T, header string, body []byte) {
		_ = VerifyContentDigest(header, body)
	})
}

func FuzzVerifyJWS(f *testing.F) {
	keys := fuzzKeys(f)
	f.Add("eyJhbGciOiJFZERTQSJ9.e30.AAAA")
	f.Add("a.b.c")
	f.Add("")
	f.Fuzz(func(t *testing.T, jws string) {
		var payload map[string]any
		_ = VerifyJWS(jws, keys, "", &payload, fuzzNow)
	})
}

func FuzzVerifyCheckpoint(f *testing.F) {
	keys := fuzzKeys(f)
	f.Add("trooth.co/semanto/log/v1\n3\nAAAA\n\n— trooth.co AAAA\n")
	f.Add("")
	f.Fuzz(func(t *testing.T, text string) {
		_ = VerifyCheckpoint(text, keys, "trooth.co/semanto/log/v1")
	})
}

func FuzzVerifyInclusion(f *testing.F) {
	f.Add([]byte("leaf"), 0, 1, []byte{}, []byte("root"))
	f.Add([]byte{}, 5, 3, make([]byte, 64), make([]byte, 32))
	f.Fuzz(func(t *testing.T, leaf []byte, index, size int, proofBytes, root []byte) {
		var proof [][]byte
		for i := 0; i+32 <= len(proofBytes) && len(proof) < 64; i += 32 {
			proof = append(proof, proofBytes[i:i+32])
		}
		_ = VerifyInclusion(leaf, index, size, proof, root)
		_ = VerifyConsistencyProof(index, size, leaf, root, proof)
	})
}
