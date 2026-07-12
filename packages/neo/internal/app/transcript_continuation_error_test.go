package app_test

import (
	"strings"
	"testing"

	"github.com/code-yeongyu/senpi/packages/neo/internal/app"
)

func TestTranscriptContinuationErrorRendersExactMessage(t *testing.T) {
	// Given: a detached continuation failure emitted by AgentSession.
	feed, tr := newTranscriptFixture(t)
	msg := eventMsg(t, `{"type":"continuation_error","errorMessage":"Failed to continue queued messages: provider unavailable"}`)

	// When: Neo translates the session event into its transcript.
	disposition := tr.HandleEvent(msg)

	// Then: the event is applied and the exact user-visible failure is rendered.
	if disposition != app.EventApplied {
		t.Fatalf("continuation_error disposition = %v, want EventApplied", disposition)
	}
	if joined := feedText(feed); !strings.Contains(joined, "Failed to continue queued messages: provider unavailable") {
		t.Fatalf("continuation_error message missing from transcript: %q", joined)
	}
}
