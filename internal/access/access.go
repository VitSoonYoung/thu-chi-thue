package access

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
)

type owner struct {
	ID          []byte                `json:"id"`
	Credentials []webauthn.Credential `json:"credentials"`
}

func (u owner) WebAuthnID() []byte                         { return u.ID }
func (u owner) WebAuthnName() string                       { return "owner" }
func (u owner) WebAuthnDisplayName() string                { return "Thu Chi & Thuế" }
func (u owner) WebAuthnCredentials() []webauthn.Credential { return u.Credentials }

type ceremony struct {
	Data    webauthn.SessionData
	Kind    string
	Origin  string
	Session string
	Expires time.Time
}

type Access struct {
	config     Config
	path       string
	mu         sync.Mutex
	user       owner
	sessions   map[string]time.Time
	ceremonies map[string]ceremony
	webauthn   *webauthn.WebAuthn
}

func New(c Config, credentialPath string) (*Access, error) {
	a := &Access{config: c, path: credentialPath, sessions: map[string]time.Time{}, ceremonies: map[string]ceremony{}}
	b, err := os.ReadFile(credentialPath)
	if err == nil {
		if err = json.Unmarshal(b, &a.user); err != nil {
			return nil, err
		}
		if len(a.user.ID) == 0 {
			return nil, errors.New("invalid passkey owner")
		}
	} else if errors.Is(err, os.ErrNotExist) {
		a.user = owner{ID: []byte(token()), Credentials: []webauthn.Credential{}}
	} else {
		return nil, err
	}
	if len(c.PasskeyOrigins) > 0 {
		a.webauthn, err = webauthn.New(&webauthn.Config{RPDisplayName: "Thu Chi & Thuế", RPID: c.PasskeyRPID, RPOrigins: c.PasskeyOrigins, AuthenticatorSelection: protocol.AuthenticatorSelection{ResidentKey: protocol.ResidentKeyRequirementRequired, UserVerification: protocol.VerificationRequired}})
		if err != nil {
			return nil, err
		}
	}
	return a, nil
}

func reply(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}
func failure(w http.ResponseWriter, status int, message string) {
	reply(w, status, map[string]string{"error": message})
}
func readJSON(r *http.Request, v any) error {
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	return d.Decode(v)
}
func (a *Access) secure(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	for _, origin := range a.config.PasskeyOrigins {
		u, _ := url.Parse(origin)
		if u.Scheme == "https" && u.Host == r.Host {
			return true
		}
	}
	return false
}
func (a *Access) cookie(w http.ResponseWriter, r *http.Request, name, value string, age int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: true, Secure: a.secure(r), SameSite: http.SameSiteStrictMode, MaxAge: age})
}
func (a *Access) session(r *http.Request) string {
	c, err := r.Cookie("thuchithue_session")
	if err == nil && a.sessions[c.Value].After(time.Now()) {
		return c.Value
	}
	return ""
}
func (a *Access) unlock(w http.ResponseWriter, r *http.Request) {
	if old, err := r.Cookie("thuchithue_session"); err == nil {
		delete(a.sessions, old.Value)
	}
	id := token()
	age := a.config.SessionHours * 3600
	a.sessions[id] = time.Now().Add(time.Duration(age) * time.Second)
	a.cookie(w, r, "thuchithue_session", id, age)
	reply(w, 200, map[string]bool{"authenticated": true})
}
func (a *Access) origin(r *http.Request) string {
	scheme := "http"
	if a.secure(r) {
		scheme = "https"
	}
	current := scheme + "://" + r.Host
	if origin := r.Header.Get("Origin"); origin != "" {
		current = origin
	}
	for _, allowed := range a.config.PasskeyOrigins {
		if allowed == current {
			return current
		}
	}
	return ""
}

func (a *Access) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if origin := r.Header.Get("Origin"); origin != "" {
			u, err := url.Parse(origin)
			if err != nil || u.Host != r.Host || (u.Scheme != "http" && u.Scheme != "https") {
				failure(w, 403, "Nguồn yêu cầu không được phép")
				return
			}
		}
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			failure(w, 403, "Nguồn yêu cầu không được phép")
			return
		}
		a.mu.Lock()
		now := time.Now()
		for id, expiry := range a.sessions {
			if !expiry.After(now) {
				delete(a.sessions, id)
			}
		}
		for id, c := range a.ceremonies {
			if !c.Expires.After(now) {
				delete(a.ceremonies, id)
			}
		}
		authenticated := a.session(r) != ""
		if strings.HasPrefix(r.URL.Path, "/api/auth/") {
			defer a.mu.Unlock()
			r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
			a.auth(w, r, authenticated)
			return
		}
		a.mu.Unlock()
		if !authenticated {
			failure(w, 401, "Vui lòng mở khóa ứng dụng")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *Access) auth(w http.ResponseWriter, r *http.Request, authenticated bool) {
	switch r.Method + " " + r.URL.Path {
	case "GET /api/auth/status":
		count := 0
		if authenticated {
			count = len(a.user.Credentials)
		}
		reply(w, 200, map[string]any{"authenticated": authenticated, "passkey_available": a.webauthn != nil && a.origin(r) != "" && len(a.user.Credentials) > 0, "passkey_supported": a.webauthn != nil && a.origin(r) != "", "passkey_count": count})
	case "POST /api/auth/password":
		var input struct {
			Password string `json:"password"`
		}
		if readJSON(r, &input) != nil {
			failure(w, 400, "Dữ liệu không hợp lệ")
			return
		}
		given, expected := sha256.Sum256([]byte(input.Password)), sha256.Sum256([]byte(a.config.AccessPassword))
		if subtle.ConstantTimeCompare(given[:], expected[:]) != 1 {
			failure(w, 401, "Mật khẩu không đúng")
			return
		}
		a.unlock(w, r)
	case "POST /api/auth/logout":
		delete(a.sessions, a.session(r))
		a.cookie(w, r, "thuchithue_session", "", -1)
		reply(w, 200, map[string]bool{"authenticated": false})
	case "POST /api/auth/passkey/register/begin", "POST /api/auth/passkey/register/finish":
		if !authenticated {
			failure(w, 401, "Vui lòng mở khóa trước khi thêm passkey")
			return
		}
		a.passkey(w, r, "register")
	case "POST /api/auth/passkey/login/begin", "POST /api/auth/passkey/login/finish":
		a.passkey(w, r, "login")
	default:
		failure(w, 404, "Không tìm thấy thao tác")
	}
}

func (a *Access) passkey(w http.ResponseWriter, r *http.Request, kind string) {
	origin := a.origin(r)
	if a.webauthn == nil || origin == "" {
		failure(w, 400, "Passkey cần địa chỉ HTTPS đã cấu hình hoặc localhost")
		return
	}
	if kind == "login" && len(a.user.Credentials) == 0 {
		failure(w, 400, "Chưa có passkey. Hãy mở khóa bằng mật khẩu trước")
		return
	}
	if strings.HasSuffix(r.URL.Path, "/begin") {
		if len(a.ceremonies) >= 256 {
			failure(w, 503, "Vui lòng thử lại sau")
			return
		}
		var options any
		var data *webauthn.SessionData
		var err error
		if kind == "register" {
			exclusions := []protocol.CredentialDescriptor{}
			for _, credential := range a.user.Credentials {
				exclusions = append(exclusions, credential.Descriptor())
			}
			options, data, err = a.webauthn.BeginRegistration(a.user, webauthn.WithExclusions(exclusions))
		} else {
			options, data, err = a.webauthn.BeginLogin(a.user, webauthn.WithUserVerification(protocol.VerificationRequired))
		}
		if err != nil {
			failure(w, 400, "Không thể bắt đầu passkey")
			return
		}
		id := token()
		a.ceremonies[id] = ceremony{Data: *data, Kind: kind, Origin: origin, Session: a.session(r), Expires: time.Now().Add(5 * time.Minute)}
		a.cookie(w, r, "thuchithue_challenge", id, 300)
		reply(w, 200, options)
		return
	}
	cookie, err := r.Cookie("thuchithue_challenge")
	if err != nil {
		failure(w, 400, "Phiên passkey đã hết hạn. Vui lòng thử lại")
		return
	}
	c, ok := a.ceremonies[cookie.Value]
	delete(a.ceremonies, cookie.Value)
	a.cookie(w, r, "thuchithue_challenge", "", -1)
	if !ok || c.Kind != kind || c.Origin != origin || (kind == "register" && c.Session != a.session(r)) {
		failure(w, 400, "Phiên passkey không hợp lệ")
		return
	}
	var credential *webauthn.Credential
	if kind == "register" {
		credential, err = a.webauthn.FinishRegistration(a.user, c.Data, r)
	} else {
		credential, err = a.webauthn.FinishLogin(a.user, c.Data, r)
	}
	if err != nil {
		failure(w, 401, "Không thể xác thực passkey. Vui lòng thử lại")
		return
	}
	updated := a.user
	updated.Credentials = append([]webauthn.Credential{}, a.user.Credentials...)
	if kind == "register" {
		updated.Credentials = append(updated.Credentials, *credential)
	} else {
		for i, existing := range updated.Credentials {
			if subtle.ConstantTimeCompare(existing.ID, credential.ID) == 1 {
				updated.Credentials[i] = *credential
			}
		}
	}
	if err = writeJSON(a.path, updated); err != nil {
		failure(w, 500, "Không thể lưu passkey")
		return
	}
	a.user = updated
	if kind == "login" {
		a.unlock(w, r)
	} else {
		reply(w, 200, map[string]bool{"registered": true})
	}
}
