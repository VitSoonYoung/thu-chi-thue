package access

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func setup(t *testing.T) (*Access, http.Handler) {
	t.Helper()
	a, err := New(Config{AccessPassword: "test password", SessionHours: 1, PasskeyRPID: "localhost", PasskeyOrigins: []string{"http://localhost:3210"}}, filepath.Join(t.TempDir(), "passkeys.json"))
	if err != nil {
		t.Fatal(err)
	}
	return a, a.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
}
func call(h http.Handler, method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://localhost:3210"+path, strings.NewReader(body))
	r.RemoteAddr = "192.168.1.5:1234"
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func login(t *testing.T, h http.Handler) *http.Cookie {
	t.Helper()
	w := call(h, "POST", "/api/auth/password", `{"password":"test password"}`, nil)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, c := range w.Result().Cookies() {
		if c.Name == "thuchithue_session" {
			return c
		}
	}
	t.Fatal("missing session cookie")
	return nil
}
func TestPasswordProtection(t *testing.T) {
	_, h := setup(t)
	for _, path := range []string{"/api/state", "/api/backup/download", "/api/attachments/1", "/api/settings/reset"} {
		if w := call(h, "GET", path, "", nil); w.Code != 401 {
			t.Fatal(path, w.Code)
		}
	}
	if w := call(h, "GET", "/", "", nil); w.Code != 200 {
		t.Fatal("static app must load")
	}
	for _, password := range []string{"", "wrong"} {
		b, _ := json.Marshal(map[string]string{"password": password})
		if w := call(h, "POST", "/api/auth/password", string(b), nil); w.Code != 401 {
			t.Fatal(w.Code)
		}
	}
	cookie := login(t, h)
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode || cookie.MaxAge != 3600 {
		t.Fatal("session cookie attributes")
	}
	if w := call(h, "GET", "/api/state", "", cookie); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if w := call(h, "GET", "/api/state", "", &http.Cookie{Name: cookie.Name, Value: "forged"}); w.Code != 401 {
		t.Fatal(w.Code)
	}
	call(h, "POST", "/api/auth/logout", "{}", cookie)
	if w := call(h, "GET", "/api/state", "", cookie); w.Code != 401 {
		t.Fatal("logout did not revoke session")
	}
}
func TestSessionExpiryAndRestart(t *testing.T) {
	a, h := setup(t)
	cookie := login(t, h)
	a.sessions[cookie.Value] = time.Now().Add(-time.Second)
	if w := call(h, "GET", "/api/state", "", cookie); w.Code != 401 {
		t.Fatal("expired session accepted")
	}
	cookie = login(t, h)
	_, fresh := setup(t)
	if w := call(fresh, "GET", "/api/state", "", cookie); w.Code != 401 {
		t.Fatal("session survived server restart")
	}
}
func TestCrossOriginAndRemoteAccess(t *testing.T) {
	_, h := setup(t)
	cookie := login(t, h)
	for _, path := range []string{"/api/state", "/api/auth/password", "/api/auth/logout"} {
		r := httptest.NewRequest("POST", "http://localhost:3210"+path, strings.NewReader(`{"password":"test password"}`))
		r.AddCookie(cookie)
		r.Header.Set("Origin", "https://evil.example")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatal(path, w.Code)
		}
	}
	r := httptest.NewRequest("GET", "http://192.168.1.10:3210/api/state", nil)
	r.RemoteAddr = "192.168.1.5:1234"
	r.AddCookie(cookie)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatal("authenticated private network access denied", w.Code)
	}
}
func TestPasskeyAuthorizationAndChallenges(t *testing.T) {
	_, h := setup(t)
	if w := call(h, "POST", "/api/auth/passkey/register/begin", "{}", nil); w.Code != 401 {
		t.Fatal(w.Code)
	}
	cookie := login(t, h)
	w := call(h, "POST", "/api/auth/passkey/register/begin", "{}", cookie)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var options map[string]any
	if json.Unmarshal(w.Body.Bytes(), &options) != nil || options["publicKey"] == nil {
		t.Fatal("missing public key options")
	}
	if w := call(h, "POST", "/api/auth/passkey/register/finish", "{}", cookie); w.Code != 400 {
		t.Fatal("missing challenge accepted")
	}
	if w := call(h, "POST", "/api/auth/passkey/login/begin", "{}", nil); w.Code != 400 {
		t.Fatal("login without registered keys")
	}
}
func TestConfigGenerationAndValidation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	c, err := LoadConfig(path)
	if err != nil || len(c.AccessPassword) < 32 || c.Listen != "0.0.0.0:3210" {
		t.Fatal(c.Listen, err)
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0600 {
		t.Fatal("config permissions", info.Mode())
	}
	again, err := LoadConfig(path)
	if err != nil || again.AccessPassword != c.AccessPassword {
		t.Fatal("config changed on reload")
	}
	c.AccessPassword = ""
	writeJSON(path, c)
	if _, err = LoadConfig(path); err == nil {
		t.Fatal("empty password accepted")
	}
	c.AccessPassword = "test"
	c.PasskeyOrigins = []string{"http://private.example"}
	writeJSON(path, c)
	if _, err = LoadConfig(path); err == nil {
		t.Fatal("insecure passkey origin accepted")
	}
}
