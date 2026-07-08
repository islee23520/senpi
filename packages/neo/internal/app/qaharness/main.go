// Command qaharness is the manual-QA driver for the neo app layer.
//
// The `welcome` scene runs the REAL root Model inside a live bubbletea v2 program
// — no alternate screen — so a tmux pane can capture the composed frame:
//
//	tmux send-keys 'go run ./internal/app/qaharness --scene welcome' Enter
//	tmux capture-pane -e -p > frame.ans
//
// The `session-turn` and `session-kill` scenes (plan task 2) drive the bridge
// SESSION ADAPTER headlessly against a real isolated `senpi --mode rpc` child
// (resolved from SENPI_NEO_CLI_PATH, pointed at the senpi-qa fake model server by
// packages/neo/qa/mock-env.mjs). They print machine-checkable STDOUT observables
// (the event-type sequence / the client-closed notice) rather than a TUI capture,
// because the surface under test is the adapter's event demux, not a rendered
// frame.
//
// It is NOT a package test; it is invoked by hand or by the tmux/CLI QA scripts.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	tea "charm.land/bubbletea/v2"

	"github.com/code-yeongyu/senpi/packages/neo/internal/app"
	"github.com/code-yeongyu/senpi/packages/neo/internal/bridge"
	"github.com/code-yeongyu/senpi/packages/neo/internal/theme"
	"github.com/code-yeongyu/senpi/packages/neo/internal/ui/extui"
	"github.com/code-yeongyu/senpi/packages/neo/internal/ui/keybindings"
	"github.com/code-yeongyu/senpi/packages/neo/internal/ui/shell"
)

const appName = "senpi"

// isolatedArgv is the hermetic isolated-backend argv the session scenes forward
// to the rpc child: a single-child backend (--isolated) with the trust prompt and
// repo resources suppressed so a QA turn never leaks state or blocks on approval.
// It mirrors mock-env.mjs's ULW_NEO_FLAGS.
var isolatedArgv = []string{
	"--isolated",
	"--approve",
	"--no-context-files",
	"--no-skills",
	"--no-extensions",
}

func main() {
	scene := flag.String("scene", "welcome", "scene: welcome | session-turn | session-kill | login-flow")
	flag.Parse()

	switch *scene {
	case "welcome":
		runWelcome()
	case "session-turn":
		os.Exit(runSessionTurn())
	case "session-kill":
		os.Exit(runSessionKill())
	case "login-flow":
		os.Exit(runLoginFlow())
	default:
		fmt.Fprintln(os.Stderr, "unknown scene:", *scene)
		os.Exit(2)
	}
}

// runWelcome runs the live root Model program (frame-capture scene).
func runWelcome() {
	th, err := theme.Load(theme.Options{Name: theme.DefaultThemeName})
	if err != nil {
		fmt.Fprintln(os.Stderr, "theme.Load:", err)
		os.Exit(1)
	}
	keys := keybindings.NewManager(nil)

	p := app.NewProgram(app.Deps{
		Theme:   th,
		Keys:    keys,
		AppName: appName,
		Welcome: welcomeContent(keys),
	})
	if _, err := p.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "qaharness error:", err)
		os.Exit(1)
	}
}

// headlessSender is a programSender that records the adapter's messages instead of
// driving a TUI: it captures the event-type sequence and signals when agent_end or
// a ClientClosedMsg arrive.
type headlessSender struct {
	mu        sync.Mutex
	events    []string
	closeMsg  string
	agentEnd  chan struct{}
	closed    chan struct{}
	endOnce   sync.Once
	closeOnce sync.Once
}

func newHeadlessSender() *headlessSender {
	return &headlessSender{
		agentEnd: make(chan struct{}),
		closed:   make(chan struct{}),
	}
}

func (h *headlessSender) Send(msg tea.Msg) {
	switch m := msg.(type) {
	case app.EventMsg:
		h.mu.Lock()
		h.events = append(h.events, m.Event.Type)
		h.mu.Unlock()
		if m.Event.Type == "agent_end" {
			h.endOnce.Do(func() { close(h.agentEnd) })
		}
	case app.ClientClosedMsg:
		h.mu.Lock()
		if m.Err != nil {
			h.closeMsg = m.Err.Error()
		}
		h.mu.Unlock()
		h.closeOnce.Do(func() { close(h.closed) })
	}
}

func (h *headlessSender) sequence() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return strings.Join(h.events, " ")
}

func (h *headlessSender) clientClosedText() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.closeMsg
}

// runSessionTurn connects an isolated child, runs one prompt turn, and prints the
// observed event-type sequence. Exit 0 once agent_end is seen.
func runSessionTurn() int {
	sess, result, err := connectIsolated()
	if err != nil {
		fmt.Fprintln(os.Stderr, "connect:", err)
		return 1
	}
	defer result.Close()

	sender := sess.sender

	// prompt responds after preflight; the turn streams via events. Fire and forget
	// — the adapter surfaces streaming through the sender.
	go func() { _ = sess.session.Prompt("hi")() }()

	select {
	case <-sender.agentEnd:
		fmt.Println("EVENTS", sender.sequence())
		return 0
	case <-time.After(60 * time.Second):
		fmt.Fprintln(os.Stderr, "timed out waiting for agent_end")
		fmt.Println("EVENTS", sender.sequence())
		return 1
	}
}

// runSessionKill connects an isolated child, kills it mid-request, and asserts the
// typed client-closed notice surfaces. It prints the killed child's pid so the QA
// cleanup receipt can name it, and kills the child itself.
func runSessionKill() int {
	sess, result, err := connectIsolated()
	if err != nil {
		fmt.Fprintln(os.Stderr, "connect:", err)
		return 1
	}
	defer result.Close()

	fmt.Printf("RPCCHILD=%d\n", childPid())

	// Start a turn so a request is in flight, then kill the child under it.
	go func() { _ = sess.session.Prompt("hi")() }()
	time.Sleep(300 * time.Millisecond)

	if st, ok := result.Transport.(*bridge.StdioTransport); ok {
		_ = st.Signal(os.Kill)
	}

	select {
	case <-sess.sender.closed:
		fmt.Println(sess.sender.clientClosedText())
		return 0
	case <-time.After(30 * time.Second):
		fmt.Fprintln(os.Stderr, "timed out waiting for client-closed notice")
		return 1
	}
}

// isolatedSession bundles the adapter with its headless sender for the scenes.
type isolatedSession struct {
	session *app.Session
	sender  *headlessSender
}

// connectIsolated spawns the isolated rpc child, wraps it in a bridge client, and
// attaches the session adapter with a headless sender.
func connectIsolated() (*isolatedSession, *bridge.ConnectResult, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return nil, nil, err
	}
	result, err := bridge.Connect(bridge.ConnectConfig{
		NeoArgv: isolatedArgv,
		GOOS:    runtime.GOOS,
		Cwd:     cwd,
	})
	if err != nil {
		return nil, nil, err
	}
	client := bridge.NewClient(result.Transport)
	sender := newHeadlessSender()
	session := app.NewSession(client, sender, result.Options)
	return &isolatedSession{session: session, sender: sender}, result, nil
}

// childPid returns the pid of this process's first child (the spawned rpc node
// process) via pgrep, best-effort. Returns 0 when it cannot be determined.
func childPid() int {
	out, err := exec.Command("pgrep", "-P", strconv.Itoa(os.Getpid())).Output()
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(out))
	if len(fields) == 0 {
		return 0
	}
	pid, err := strconv.Atoi(fields[0])
	if err != nil {
		return 0
	}
	return pid
}

// welcomeContent builds the startup card content, resolving every menu key hint
// through the keybinding manager (no literal key strings).
func welcomeContent(keys *keybindings.Manager) shell.WelcomeContent {
	return shell.WelcomeContent{
		Title: appName,
		Menu: []shell.MenuEntry{
			{Label: "Resume session", Key: firstKey(keys, "app.sessions.observe")},
			{Label: "Search history", Key: firstKey(keys, "app.history.search")},
			{Label: "Quit", Key: firstKey(keys, "app.exit")},
		},
	}
}

func firstKey(keys *keybindings.Manager, action string) string {
	if k := keys.Keys(action); len(k) > 0 {
		return k[0]
	}
	return ""
}

// ---------------------------------------------------------------------------
// login-flow scene (plan todo 6)
// ---------------------------------------------------------------------------

// runLoginFlow drives the REAL login dialog through the app extension-UI layer
// with synthetic auth events: get_auth_providers answers with a stub oauth
// provider, selecting it fires login_start against a stub client (NO timeout),
// then an auth_login_url and a successful auth_login_end EventMsg are injected
// in order. The URL-panel frame renders first (with a capture window), then the
// post-login state prints as machine-checkable lines.
func runLoginFlow() int {
	th, err := theme.Load(theme.Options{Name: theme.DefaultThemeName})
	if err != nil {
		fmt.Fprintln(os.Stderr, "theme.Load:", err)
		return 1
	}
	keys := keybindings.NewManager(nil)
	mgr := app.NewManager(keys, stubOverlayRequester{})
	ext := app.NewExtUI(extui.Deps{Theme: th, Keybindings: keys}, mgr, stubAuthClient{}, stubResponder{}, stubSink{})

	// get_auth_providers → provider list.
	providersMsg, ok := ext.OpenLogin("")().(app.LoginProvidersMsg)
	if !ok || providersMsg.Err != nil {
		fmt.Fprintln(os.Stderr, "login-flow: provider fetch failed:", providersMsg.Err)
		return 1
	}
	drainLoginCmds(ext.HandleLoginProviders(providersMsg))
	drainLoginCmds(ext.HandleKey("\r").Cmd) // select the stub provider → login_start (flow view)

	// auth_login_url EventMsg → the URL panel frame.
	urlMsg := app.EventMsg{Event: bridge.Event{
		Type:    "auth_login_url",
		Payload: []byte(`{"type":"auth_login_url","provider":"stub","url":"https://stub.example/oauth?code=FAKE"}`),
	}}
	ext.HandleEvent(urlMsg.Event)
	fmt.Println("=== login-flow: auth_login_url ===")
	for _, line := range ext.Render(100, 30) {
		fmt.Println(line)
	}
	time.Sleep(2 * time.Second) // capture window for the URL panel

	// auth_login_end EventMsg → the dialog closes with status.
	endMsg := app.EventMsg{Event: bridge.Event{
		Type:    "auth_login_end",
		Payload: []byte(`{"type":"auth_login_end","provider":"stub","success":true}`),
	}}
	res := ext.HandleEvent(endMsg.Event)
	fmt.Println("=== login-flow: auth_login_end ===")
	drainLoginCmds(res.Cmd)
	fmt.Printf("LOGIN-FLOW provider=stub success=true dialogActive=%v\n", ext.Active())
	return 0
}

// drainLoginCmds executes queued tea.Cmds synchronously, printing NoticeMsg
// lines so the capture shows the login status notice.
func drainLoginCmds(cmd tea.Cmd) {
	if cmd == nil {
		return
	}
	switch m := cmd().(type) {
	case tea.BatchMsg:
		for _, sub := range m {
			drainLoginCmds(sub)
		}
	case app.NoticeMsg:
		fmt.Println("NOTICE " + m.Text)
	}
}

// stubOverlayRequester satisfies app.Requester for the overlay manager; the
// login-flow scene never routes an overlay outcome through it.
type stubOverlayRequester struct{}

func (stubOverlayRequester) Request(bridge.Command) tea.Cmd        { return nil }
func (stubOverlayRequester) FileOp(string, map[string]any) tea.Cmd { return nil }

// stubAuthClient answers get_auth_providers with one stub oauth provider and
// acknowledges every other auth command (login_start succeeds immediately; the
// flow completes via the injected events).
type stubAuthClient struct{}

func (stubAuthClient) Request(cmd bridge.Command, _ time.Duration) (bridge.Response, error) {
	if cmd.Type == "get_auth_providers" {
		return bridge.Response{
			Type:    "response",
			Command: cmd.Type,
			Success: true,
			Data:    json.RawMessage(`{"providers":[{"id":"stub","name":"Stub Provider","authType":"oauth","status":{"configured":false}}]}`),
		}, nil
	}
	return bridge.Response{Type: "response", Command: cmd.Type, Success: true}, nil
}

// stubResponder and stubSink are inert seams: the login flow sends no
// extension_ui_response and applies no directives.
type stubResponder struct{}

func (stubResponder) RespondExtensionUI(bridge.ExtensionUIResponse) error { return nil }

type stubSink struct{}

func (stubSink) ApplyDirective(extui.Directive) {}
