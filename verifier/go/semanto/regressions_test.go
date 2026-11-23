package semanto

import (
	"testing"
	"time"
)

// A Signature-Input parameter whose value is a lone quote reads as an empty value, as in the Python verifier,
// and does not panic.
func TestParseSignatureInputLoneQuote(t *testing.T) {
	for _, in := range []string{
		`sig1=("@status");created=1729598400;keyid="abc";tag="`,
		`sig1=("@status");created=1729598400;keyid=";alg="ed25519"`,
		`sig1=();created=1;keyid="`,
	} {
		func() {
			defer func() {
				if r := recover(); r != nil {
					t.Fatalf("ParseSignatureInput(%q) panicked: %v", in, r)
				}
			}()
			_ = ParseSignatureInput(in)
		}()
	}
	got := ParseSignatureInput(`sig1=("@status");created=1729598400;keyid="abc";tag="`)
	if s, ok := got["sig1"]; !ok || s.Params.Tag != "" || s.Params.KeyID != "abc" {
		t.Fatalf("lone-quote tag: got %+v", got)
	}
}

// Negative tree sizes are refused at once; they once looped forever in VerifyConsistencyProof.
func TestVerifyConsistencyProofNegativeSizes(t *testing.T) {
	done := make(chan bool, 1)
	go func() {
		proof := [][]byte{make([]byte, 32), make([]byte, 32)}
		done <- VerifyConsistencyProof(-32, -22, []byte("0"), []byte("0"), proof) || VerifyConsistencyProof(-1, 5, nil, nil, proof) || VerifyInclusion([]byte("0"), -32, -22, proof, nil)
	}()
	select {
	case got := <-done:
		if got {
			t.Fatal("a negative tree size was accepted")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("VerifyConsistencyProof did not return for negative sizes")
	}
}
