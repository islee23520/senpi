package app_test

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"

	"github.com/code-yeongyu/senpi/packages/neo/internal/app"
	"github.com/code-yeongyu/senpi/packages/neo/internal/bridge"
	"github.com/code-yeongyu/senpi/packages/neo/internal/theme"
	"github.com/code-yeongyu/senpi/packages/neo/internal/ui"
	"github.com/code-yeongyu/senpi/packages/neo/internal/ui/extui"
	"github.com/code-yeongyu/senpi/packages/neo/internal/ui/keybindings"
)

// extui_test.go is the todo-6 contract: an ExtensionUIRequestMsg routes through
// extui.DialogForRequest / ApplyRequest — interactive dialogs enter the todo-5
// overlay Manager and answer with an extension_ui_response carrying the ORIGINAL
// request id, directives land on the narrow DirectiveSink, custom_unsupported
// renders the builtinext notice — and the /login /logout flows run
// get_auth_providers → login_start (NO timeout) → auth_login_url → auth_login_end
// with login_cancel on esc. Every one of the 10 mirrored methods
// (bridge.KnownExtensionUIMethods) round-trips through the table test.

// --- fakes -------------------------------------------------------------------

// authCall records one RPC command issued through the ExtUIRequestDoer seam,
// including the per-call timeout (the login_start exemption is asserted on it).
type authCall struct {
	cmd     bridge.Command
	timeout time.Duration
}

type fakeAuthClient struct {
	responses map[string]bridge.Response
	err       error
	calls     []authCall
}

func (f *fakeAuthClient) Request(cmd bridge.Command, timeout time.Duration) (bridge.Response, error) {
	f.calls = append(f.calls, authCall{cmd: cmd, timeout: timeout})
	if f.err != nil {
		return bridge.Response{}, f.err
	}
	if resp, ok := f.responses[cmd.Type]; ok {
		return resp, nil
	}
	return bridge.Response{Type: "response", Command: cmd.Type, Success: true}, nil
}

func (f *fakeAuthClient) call(cmdType string) (authCall, bool) {
	for _, c := range f.calls {
		if c.cmd.Type == cmdType {
			return c, true
		}
	}
	return authCall{}, false
}

type fakeResponder struct {
	sent []bridge.ExtensionUIResponse
}

func (f *fakeResponder) RespondExtensionUI(resp bridge.ExtensionUIResponse) error {
	f.sent = append(f.sent, resp)
	return nil
}

type fakeSink struct {
	directives []extui.Directive
}

func (f *fakeSink) ApplyDirective(d extui.Directive) { f.directives = append(f.directives, d) }

// --- harness -----------------------------------------------------------------

type extUIHarness struct {
	ext       *app.ExtUI
	mgr       *app.Manager
	client    *fakeAuthClient
	responder *fakeResponder
	sink      *fakeSink
}

func newExtUIHarness(t *testing.T) *extUIHarness {
	t.Helper()
	th, err := theme.Load(theme.Options{Name: theme.DefaultThemeName, AgentDir: "\x00nonexistent"})
	if err != nil {
		t.Fatalf("theme.Load: %v", err)
	}
	keys := keybindings.NewManager(nil)
	client := &fakeAuthClient{responses: map[string]bridge.Response{}}
	responder := &fakeResponder{}
	sink := &fakeSink{}
	mgr := app.NewManager(keys, &fakeRequester{})
	ext := app.NewExtUI(extui.Deps{Theme: th, Keybindings: keys}, mgr, client, responder, sink)
	return &extUIHarness{ext: ext, mgr: mgr, client: client, responder: responder, sink: sink}
}

// press feeds raw keys through the composite ExtUI (the Model's overlay path)
// and executes any attached commands, returning the last key's result.
func (h *extUIHarness) press(keys ...string) app.OverlayKeyResult {
	var last app.OverlayKeyResult
	for _, k := range keys {
		last = h.ext.HandleKey(k)
		runTeaCmd(last.Cmd)
	}
	return last
}

// runTeaCmd executes a tea.Cmd synchronously (recursing into batches) and
// returns every message it produced.
func runTeaCmd(cmd tea.Cmd) []tea.Msg {
	if cmd == nil {
		return nil
	}
	msg := cmd()
	if batch, ok := msg.(tea.BatchMsg); ok {
		var out []tea.Msg
		for _, sub := range batch {
			out = append(out, runTeaCmd(sub)...)
		}
		return out
	}
	if msg == nil {
		return nil
	}
	return []tea.Msg{msg}
}

func extReq(id, method string, fields map[string]any) bridge.ExtensionUIRequest {
	return bridge.ExtensionUIRequest{Type: "extension_ui_request", ID: id, Method: method, Fields: fields}
}

func plainFrame(lines []string) string { return ui.StripANSI(strings.Join(lines, "\n")) }

func authEvent(t *testing.T, evType string, fields map[string]any) bridge.Event {
	t.Helper()
	payload := map[string]any{"type": evType}
	for k, v := range fields {
		payload[k] = v
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal %s payload: %v", evType, err)
	}
	return bridge.Event{Type: evType, Payload: raw}
}

// --- request → dialog → response round-trips (all 10 mirrored methods) --------

// TestExtUIRoundTripCoversAllMirroredMethods drives every mirrored
// extension_ui_request method through the app layer: the four interactive
// dialogs answer with an extension_ui_response carrying the original request
// id, the five directives land on the DirectiveSink without a response, and
// custom_unsupported renders the builtinext notice (dismissed, no response).
// The coverage set is asserted against bridge.KnownExtensionUIMethods().
func TestExtUIRoundTripCoversAllMirroredMethods(t *testing.T) {
	yes := true
	type wantResp struct {
		confirmed *bool
		value     string
		cancelled bool
	}
	cases := []struct {
		method    string
		fields    map[string]any
		keys      []string
		want      *wantResp
		directive bool
		sinkKind  extui.DirectiveKind
		notice    bool
	}{
		{
			method: "select",
			fields: map[string]any{"title": "Pick one", "options": []any{"option-1", "option-2"}},
			keys:   []string{"\x1b[B", "\r"},
			want:   &wantResp{value: "option-2"},
		},
		{
			method: "confirm",
			fields: map[string]any{"title": "Proceed?", "message": "apply the change"},
			keys:   []string{"\r"},
			want:   &wantResp{confirmed: &yes},
		},
		{
			method: "input",
			fields: map[string]any{"title": "Name", "placeholder": "your name"},
			keys:   []string{"n", "e", "o", "\r"},
			want:   &wantResp{value: "neo"},
		},
		{
			method: "editor",
			fields: map[string]any{"title": "Edit note", "prefill": "line1"},
			keys:   []string{"\n"}, // ctrl+j submits the multiline editor
			want:   &wantResp{value: "line1"},
		},
		{method: "notify", fields: map[string]any{"message": "hi", "notifyType": "warning"}, directive: true, sinkKind: extui.DirectiveNotify},
		{method: "setStatus", fields: map[string]any{"statusKey": "k", "statusText": "busy"}, directive: true, sinkKind: extui.DirectiveSetStatus},
		{method: "setWidget", fields: map[string]any{"widgetKey": "w", "widgetLines": []any{"l1"}}, directive: true, sinkKind: extui.DirectiveSetWidget},
		{method: "setTitle", fields: map[string]any{"title": "My Title"}, directive: true, sinkKind: extui.DirectiveSetTitle},
		{method: "set_editor_text", fields: map[string]any{"text": "prefill"}, directive: true, sinkKind: extui.DirectiveSetEditorText},
		{
			method: "custom_unsupported",
			fields: map[string]any{"extensionName": "doom-overlay"},
			keys:   []string{"\r"},
			notice: true,
		},
	}

	if want := len(bridge.KnownExtensionUIMethods()); len(cases) != want {
		t.Fatalf("round-trip table has %d cases, want all %d mirrored methods", len(cases), want)
	}

	covered := map[string]bool{}
	for _, tc := range cases {
		t.Run(tc.method, func(t *testing.T) {
			h := newExtUIHarness(t)
			cmd := h.ext.HandleRequest(extReq("req-ext-1", tc.method, tc.fields), "saved draft")
			if cmd != nil {
				t.Fatalf("%s: request without a timeout field must not arm a timer", tc.method)
			}

			if tc.directive {
				if h.ext.Active() {
					t.Fatalf("%s: a fire-and-forget directive must not open an overlay", tc.method)
				}
				if len(h.sink.directives) != 1 || h.sink.directives[0].Kind != tc.sinkKind {
					t.Fatalf("%s: expected one %v directive on the sink, got %+v", tc.method, tc.sinkKind, h.sink.directives)
				}
				if len(h.responder.sent) != 0 {
					t.Fatalf("%s: directives must not send an extension_ui_response, got %+v", tc.method, h.responder.sent)
				}
				covered[tc.method] = true
				return
			}

			if !h.ext.Active() {
				t.Fatalf("%s: dialog request must open an overlay", tc.method)
			}
			if frame := plainFrame(h.ext.Render(80, 24)); strings.TrimSpace(frame) == "" {
				t.Fatalf("%s: active dialog rendered an empty frame", tc.method)
			}
			res := h.press(tc.keys...)
			if h.ext.Active() {
				t.Fatalf("%s: dialog must close after its terminal key", tc.method)
			}
			if !res.Restore || res.RestoreText != "saved draft" {
				t.Fatalf("%s: closing must restore the saved editor text, got %+v", tc.method, res)
			}

			if tc.notice {
				if len(h.responder.sent) != 0 {
					t.Fatalf("custom_unsupported must not send a response, got %+v", h.responder.sent)
				}
				covered[tc.method] = true
				return
			}

			if len(h.responder.sent) != 1 {
				t.Fatalf("%s: expected exactly one extension_ui_response, got %+v", tc.method, h.responder.sent)
			}
			sent := h.responder.sent[0]
			if sent.Type != "extension_ui_response" || sent.ID != "req-ext-1" {
				t.Fatalf("%s: response must carry the original request id, got %+v", tc.method, sent)
			}
			if sent.Cancelled != tc.want.cancelled || sent.Value != tc.want.value {
				t.Fatalf("%s: response = %+v, want value=%q cancelled=%v", tc.method, sent, tc.want.value, tc.want.cancelled)
			}
			if (sent.Confirmed == nil) != (tc.want.confirmed == nil) {
				t.Fatalf("%s: confirmed presence mismatch: %+v", tc.method, sent)
			}
			if sent.Confirmed != nil && *sent.Confirmed != *tc.want.confirmed {
				t.Fatalf("%s: confirmed = %v, want %v", tc.method, *sent.Confirmed, *tc.want.confirmed)
			}
			covered[tc.method] = true
		})
	}

	for method := range bridge.KnownExtensionUIMethods() {
		if !covered[method] {
			t.Errorf("mirrored extension-UI method %q has no passing round-trip case", method)
		}
	}
}

// TestExtUIRenderShowsCustomUnsupportedName pins the notice copy: the dialog
// names the extension and the classic-TUI fallback.
func TestExtUIRenderShowsCustomUnsupportedName(t *testing.T) {
	h := newExtUIHarness(t)
	h.ext.HandleRequest(extReq("req-cu", "custom_unsupported", map[string]any{"extensionName": "doom-overlay"}), "")
	frame := plainFrame(h.ext.Render(100, 24))
	if !strings.Contains(frame, "doom-overlay") || !strings.Contains(frame, "classic TUI") {
		t.Fatalf("notice must name the extension and the classic TUI fallback, got:\n%s", frame)
	}
}

// TestExtUIDialogEscSendsCancelled proves esc answers the request with a
// cancellation (the TS pending map resolves its default) and restores the
// editor text.
func TestExtUIDialogEscSendsCancelled(t *testing.T) {
	h := newExtUIHarness(t)
	h.ext.HandleRequest(extReq("req-esc", "select", map[string]any{"title": "Pick", "options": []any{"a", "b"}}), "draft")
	res := h.press("\x1b")
	if h.ext.Active() {
		t.Fatal("esc must close the dialog")
	}
	if !res.Restore || res.RestoreText != "draft" {
		t.Fatalf("esc must restore the saved editor text, got %+v", res)
	}
	if len(h.responder.sent) != 1 || !h.responder.sent[0].Cancelled || h.responder.sent[0].ID != "req-esc" {
		t.Fatalf("esc must send a cancelled response with the request id, got %+v", h.responder.sent)
	}
}

// --- timeout semantics ---------------------------------------------------------

// TestExtUIDialogTimeoutSendsDefaultCancel proves a timeout-bearing request arms
// a timer whose expiry sends the default cancel response (connection-handler.ts
// resolves the default at the same deadline) and closes the dialog, restoring
// the editor text.
func TestExtUIDialogTimeoutSendsDefaultCancel(t *testing.T) {
	h := newExtUIHarness(t)
	cmd := h.ext.HandleRequest(extReq("req-to", "confirm", map[string]any{"title": "Sure?", "message": "m", "timeout": float64(5)}), "kept")
	if cmd == nil {
		t.Fatal("a timeout-bearing request must arm a timer command")
	}
	msgs := runTeaCmd(cmd) // sleeps ~5ms then emits the timeout message
	if len(msgs) != 1 {
		t.Fatalf("timer command must emit one message, got %+v", msgs)
	}
	tm, ok := msgs[0].(app.ExtUIDialogTimeoutMsg)
	if !ok || tm.ID != "req-to" {
		t.Fatalf("expected ExtUIDialogTimeoutMsg{req-to}, got %#v", msgs[0])
	}
	res := h.ext.HandleTimeout(tm)
	runTeaCmd(res.Cmd)
	if h.ext.Active() {
		t.Fatal("timeout must close the dialog")
	}
	if !res.Restore || res.RestoreText != "kept" {
		t.Fatalf("timeout close must restore the saved editor text, got %+v", res)
	}
	if len(h.responder.sent) != 1 || !h.responder.sent[0].Cancelled || h.responder.sent[0].ID != "req-to" {
		t.Fatalf("timeout must send the default cancel response, got %+v", h.responder.sent)
	}
}

// TestExtUIDialogTimeoutAfterAnswerIsNoop proves a stale timeout for an
// already-answered dialog sends nothing (no duplicate response).
func TestExtUIDialogTimeoutAfterAnswerIsNoop(t *testing.T) {
	h := newExtUIHarness(t)
	cmd := h.ext.HandleRequest(extReq("req-late", "confirm", map[string]any{"title": "Sure?", "message": "m", "timeout": float64(5)}), "")
	h.press("\r") // answer before the timer fires
	msgs := runTeaCmd(cmd)
	res := h.ext.HandleTimeout(msgs[0].(app.ExtUIDialogTimeoutMsg))
	runTeaCmd(res.Cmd)
	if len(h.responder.sent) != 1 {
		t.Fatalf("stale timeout must not send a second response, got %+v", h.responder.sent)
	}
}

// --- login / logout flows -------------------------------------------------------

func stubProvidersResponse() bridge.Response {
	return bridge.Response{
		Type:    "response",
		Command: "get_auth_providers",
		Success: true,
		Data: json.RawMessage(`{"providers":[` +
			`{"id":"stub","name":"Stub Provider","authType":"oauth","status":{"configured":false}},` +
			`{"id":"keyprov","name":"Key Provider","authType":"api_key","status":{"configured":false}}]}`),
	}
}

// openLogin drives the provider fetch → dialog push for the given mode.
func openLogin(t *testing.T, h *extUIHarness, mode string) {
	t.Helper()
	h.client.responses["get_auth_providers"] = stubProvidersResponse()
	var cmd tea.Cmd
	if mode == "logout" {
		cmd = h.ext.OpenLogout("login draft")
	} else {
		cmd = h.ext.OpenLogin("login draft")
	}
	msgs := runTeaCmd(cmd)
	if len(msgs) != 1 {
		t.Fatalf("provider fetch must emit one message, got %+v", msgs)
	}
	pm, ok := msgs[0].(app.LoginProvidersMsg)
	if !ok {
		t.Fatalf("expected LoginProvidersMsg, got %#v", msgs[0])
	}
	if pm.Err != nil {
		t.Fatalf("provider fetch failed: %v", pm.Err)
	}
	runTeaCmd(h.ext.HandleLoginProviders(pm))
	if !h.ext.Active() {
		t.Fatal("the login dialog must be open after the provider fetch resolves")
	}
}

// TestExtUILoginFlowURLPanelAndSuccessClose is the full happy path: /login →
// get_auth_providers → provider select fires login_start with NO timeout (the
// event-completed exemption) → auth_login_url renders the URL panel →
// a successful auth_login_end closes the dialog with a status notice.
func TestExtUILoginFlowURLPanelAndSuccessClose(t *testing.T) {
	h := newExtUIHarness(t)
	openLogin(t, h, "login")

	if frame := plainFrame(h.ext.Render(90, 30)); !strings.Contains(frame, "Stub Provider") {
		t.Fatalf("login dialog must list the fetched providers, got:\n%s", frame)
	}

	h.press("\r") // select the oauth provider
	call, ok := h.client.call("login_start")
	if !ok {
		t.Fatalf("selecting an oauth provider must fire login_start, calls=%+v", h.client.calls)
	}
	if call.timeout != 0 {
		t.Fatalf("login_start must be issued with NO timeout (event-completed exemption), got %s", call.timeout)
	}
	if call.cmd.Fields["provider"] != "stub" {
		t.Fatalf("login_start must target the selected provider, got %+v", call.cmd.Fields)
	}
	if !h.ext.Active() {
		t.Fatal("the flow view must stay open awaiting auth events")
	}

	res := h.ext.HandleEvent(authEvent(t, "auth_login_url", map[string]any{"provider": "stub", "url": "https://stub.example/oauth?code=FAKE"}))
	if !res.Handled {
		t.Fatal("auth_login_url must be consumed by the live login dialog")
	}
	if frame := plainFrame(h.ext.Render(90, 30)); !strings.Contains(frame, "stub.example/oauth") {
		t.Fatalf("the flow view must render the auth URL, got:\n%s", frame)
	}

	res = h.ext.HandleEvent(authEvent(t, "auth_login_end", map[string]any{"provider": "stub", "success": true}))
	if !res.Handled {
		t.Fatal("auth_login_end must be consumed by the live login dialog")
	}
	msgs := runTeaCmd(res.Cmd)
	if h.ext.Active() {
		t.Fatal("a successful auth_login_end must close the login dialog")
	}
	if !res.Restore || res.RestoreText != "login draft" {
		t.Fatalf("closing the login dialog must restore the saved editor text, got %+v", res)
	}
	statusSeen := false
	for _, m := range msgs {
		if n, ok := m.(app.NoticeMsg); ok && strings.Contains(n.Text, "stub") {
			statusSeen = true
		}
	}
	if !statusSeen {
		t.Fatalf("login completion must surface a status notice, got %+v", msgs)
	}
}

// TestExtUILoginEndFailureKeepsDialogWithError proves a failed auth_login_end
// keeps the flow view open and renders the error.
func TestExtUILoginEndFailureKeepsDialogWithError(t *testing.T) {
	h := newExtUIHarness(t)
	openLogin(t, h, "login")
	h.press("\r")
	h.ext.HandleEvent(authEvent(t, "auth_login_url", map[string]any{"provider": "stub", "url": "https://stub.example/oauth"}))
	res := h.ext.HandleEvent(authEvent(t, "auth_login_end", map[string]any{"provider": "stub", "success": false, "error": "oauth port busy"}))
	if !res.Handled {
		t.Fatal("the failed auth_login_end must still be consumed")
	}
	if !h.ext.Active() {
		t.Fatal("a failed login must keep the dialog open to show the error")
	}
	if frame := plainFrame(h.ext.Render(90, 30)); !strings.Contains(frame, "oauth port busy") {
		t.Fatalf("the flow view must render the login error, got:\n%s", frame)
	}
}

// TestExtUILoginEscMidFlowEmitsLoginCancel proves esc during the URL wait fires
// login_cancel for the in-flight provider and closes the dialog.
func TestExtUILoginEscMidFlowEmitsLoginCancel(t *testing.T) {
	h := newExtUIHarness(t)
	openLogin(t, h, "login")
	h.press("\r")
	h.ext.HandleEvent(authEvent(t, "auth_login_url", map[string]any{"provider": "stub", "url": "https://stub.example/oauth"}))

	res := h.press("\x1b")
	call, ok := h.client.call("login_cancel")
	if !ok || call.cmd.Fields["provider"] != "stub" {
		t.Fatalf("esc mid-flow must fire login_cancel for the provider, calls=%+v", h.client.calls)
	}
	if h.ext.Active() {
		t.Fatal("esc mid-flow must close the login dialog")
	}
	if !res.Restore || res.RestoreText != "login draft" {
		t.Fatalf("cancelling the login must restore the saved editor text, got %+v", res)
	}
}

// TestExtUILogoutEmitsLogout proves the logout mode fires the logout command for
// the selected provider and closes.
func TestExtUILogoutEmitsLogout(t *testing.T) {
	h := newExtUIHarness(t)
	openLogin(t, h, "logout")
	h.press("\r")
	call, ok := h.client.call("logout")
	if !ok || call.cmd.Fields["provider"] != "stub" {
		t.Fatalf("logout selection must fire logout for the provider, calls=%+v", h.client.calls)
	}
	if h.ext.Active() {
		t.Fatal("logout must close the dialog")
	}
}

// TestExtUILoginAPIKeyPromptEmitsLoginAPIKey proves selecting an api_key
// provider opens the key input and submit fires login_api_key (never an
// extension_ui_response — it is a login step, not an extension request).
func TestExtUILoginAPIKeyPromptEmitsLoginAPIKey(t *testing.T) {
	h := newExtUIHarness(t)
	openLogin(t, h, "login")
	h.press("\x1b[B") // move to the api_key provider
	h.press("\r")     // open the key prompt
	if !h.ext.Active() {
		t.Fatal("selecting an api_key provider must open the key input")
	}
	h.press("k", "1", "\r")
	call, ok := h.client.call("login_api_key")
	if !ok {
		t.Fatalf("submitting the key must fire login_api_key, calls=%+v", h.client.calls)
	}
	if call.cmd.Fields["provider"] != "keyprov" || call.cmd.Fields["key"] != "k1" {
		t.Fatalf("login_api_key must carry provider+key, got %+v", call.cmd.Fields)
	}
	if len(h.responder.sent) != 0 {
		t.Fatalf("the login key prompt must not send an extension_ui_response, got %+v", h.responder.sent)
	}
}

// TestExtUILoginProviderFetchErrorSurfacesNotice proves a failed
// get_auth_providers surfaces a one-line notice instead of opening a dialog.
func TestExtUILoginProviderFetchErrorSurfacesNotice(t *testing.T) {
	h := newExtUIHarness(t)
	h.client.err = errors.New("bridge unavailable")
	msgs := runTeaCmd(h.ext.OpenLogin(""))
	pm, ok := msgs[0].(app.LoginProvidersMsg)
	if !ok || pm.Err == nil {
		t.Fatalf("expected an errored LoginProvidersMsg, got %#v", msgs[0])
	}
	noticeMsgs := runTeaCmd(h.ext.HandleLoginProviders(pm))
	if h.ext.Active() {
		t.Fatal("a failed provider fetch must not open a dialog")
	}
	found := false
	for _, m := range noticeMsgs {
		if n, ok := m.(app.NoticeMsg); ok && strings.Contains(n.Text, "bridge unavailable") {
			found = true
		}
	}
	if !found {
		t.Fatalf("the fetch error must surface as a notice, got %+v", noticeMsgs)
	}
}
