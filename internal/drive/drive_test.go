package drive

import (
	"context"
	"crypto/md5"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"thuchithue/internal/store"
	"time"
)

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(status int, value any) *http.Response {
	b, _ := json.Marshal(value)
	return &http.Response{StatusCode: status, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(string(b)))}
}
func setup(t *testing.T) (*Drive, http.Handler) {
	t.Helper()
	dir := t.TempDir()
	s, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.DB.Close() })
	d, err := New(dir, s, &Config{ClientID: "test.apps.googleusercontent.com", ClientSecret: "test secret", RedirectURL: "http://localhost:3210/api/drive/callback"})
	if err != nil {
		t.Fatal(err)
	}
	return d, d.Handler()
}
func call(h http.Handler, method, path, body string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://localhost:3210"+path, strings.NewReader(body))
	for _, c := range cookies {
		r.AddCookie(c)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func TestOAuthBackupRefreshAndDisconnect(t *testing.T) {
	d, h := setup(t)
	begin := call(h, "POST", "/api/drive/connect", "{}")
	if begin.Code != 200 {
		t.Fatal(begin.Body.String())
	}
	var link map[string]string
	json.Unmarshal(begin.Body.Bytes(), &link)
	authURL, _ := url.Parse(link["url"])
	state := authURL.Query().Get("state")
	if authURL.Query().Get("scope") != scope || authURL.Query().Get("access_type") != "offline" || state == "" {
		t.Fatal("invalid authorization request")
	}
	cookie := begin.Result().Cookies()[0]
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != callbackPath {
		t.Fatal("invalid callback cookie")
	}
	var name string
	uploads, refreshes, revokes := 0, 0, 0
	d.client.Transport = roundTrip(func(r *http.Request) (*http.Response, error) {
		switch {
		case r.URL.Host == "oauth2.googleapis.com" && r.URL.Path == "/token":
			r.ParseForm()
			if r.Form.Get("client_secret") != "test secret" {
				t.Fatal("missing OAuth secret")
			}
			if r.Form.Get("grant_type") == "authorization_code" {
				hash := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
				if base64.RawURLEncoding.EncodeToString(hash[:]) != authURL.Query().Get("code_challenge") {
					t.Fatal("PKCE mismatch")
				}
				return response(200, map[string]any{"access_token": "access", "refresh_token": "refresh", "expires_in": 3600, "scope": scope}), nil
			}
			if r.Form.Get("refresh_token") != "refresh" {
				t.Fatal("missing refresh token")
			}
			refreshes++
			return response(200, map[string]any{"access_token": "refreshed", "expires_in": 3600, "scope": scope}), nil
		case r.URL.Path == "/drive/v3/about":
			return response(200, map[string]any{"user": map[string]string{"emailAddress": "owner@example.com"}}), nil
		case r.URL.Path == "/drive/v3/files" && r.Method == "GET":
			return response(200, map[string]any{"files": []File{}}), nil
		case r.URL.Path == "/drive/v3/files" && r.Method == "POST":
			var body map[string]any
			json.NewDecoder(r.Body).Decode(&body)
			if body["mimeType"] != "application/vnd.google-apps.folder" {
				t.Fatal("wrong folder type")
			}
			return response(200, File{ID: "folder", Name: "Thu Chi & Thuế Backups", WebViewLink: "https://drive.google.com/drive/folders/folder"}), nil
		case r.URL.Path == "/upload/drive/v3/files" && r.Method == "POST":
			var body struct {
				Name    string   `json:"name"`
				Parents []string `json:"parents"`
			}
			json.NewDecoder(r.Body).Decode(&body)
			name = body.Name
			if len(body.Parents) != 1 || body.Parents[0] != "folder" || r.Header.Get("X-Upload-Content-Length") == "" {
				t.Fatal("invalid upload metadata")
			}
			res := response(200, map[string]any{})
			res.Header.Set("Location", "https://www.googleapis.com/upload/drive/v3/files?upload_id=test")
			return res, nil
		case r.URL.Path == "/upload/drive/v3/files" && r.Method == "PUT":
			b, _ := io.ReadAll(r.Body)
			if !strings.HasPrefix(string(b), "SQLite format 3") {
				t.Fatal("not a SQLite snapshot")
			}
			if int64(len(b)) != r.ContentLength {
				t.Fatal("upload length mismatch")
			}
			hash := md5.Sum(b)
			uploads++
			return response(200, File{ID: fmt.Sprint(uploads), Name: name, Size: strconv.Itoa(len(b)), MD5: hex.EncodeToString(hash[:]), WebViewLink: "https://drive.google.com/file/d/backup/view"}), nil
		case r.URL.Path == "/revoke":
			r.ParseForm()
			if r.Form.Get("token") != "refresh" {
				t.Fatal("wrong revocation token")
			}
			revokes++
			return response(200, map[string]any{}), nil
		}
		t.Fatalf("unexpected request %s %s", r.Method, r.URL)
		return nil, nil
	})
	bad := httptest.NewRecorder()
	d.Callback(bad, httptest.NewRequest("GET", "http://localhost:3210/api/drive/callback?state="+state+"&code=test", nil))
	if bad.Code != 400 {
		t.Fatal("callback without cookie accepted")
	}
	r := httptest.NewRequest("GET", "http://localhost:3210/api/drive/callback?state="+state+"&code=test", nil)
	r.AddCookie(cookie)
	w := httptest.NewRecorder()
	d.Callback(w, r)
	if w.Code != 303 || !strings.HasSuffix(w.Header().Get("Location"), "?drive=connected") {
		t.Fatal(w.Code, w.Body.String())
	}
	replay := httptest.NewRecorder()
	d.Callback(replay, r)
	if replay.Code != 400 {
		t.Fatal("callback replay accepted")
	}
	info, err := os.Stat(filepath.Join(d.directory, "drive_tokens.json"))
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("token file permissions", err)
	}
	for i := 0; i < 2; i++ {
		if i == 1 {
			d.auth.Expiry = time.Now().Add(-time.Hour)
		}
		w = call(h, "POST", "/api/drive/backup", "{}")
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if uploads != 2 || refreshes != 1 {
		t.Fatal("upload or token refresh failed", uploads, refreshes)
	}
	paths, _ := filepath.Glob(filepath.Join(d.directory, "snapshot_*.db"))
	if len(paths) != 0 {
		t.Fatal("snapshot was not cleaned up")
	}
	loaded, err := New(d.directory, d.store, &d.cfg)
	if err != nil || loaded.auth.RefreshToken != "refresh" || loaded.auth.LastBackup == nil {
		t.Fatal("connection did not persist", err)
	}
	status := call(h, "GET", "/api/drive/status", "")
	if strings.Contains(status.Body.String(), "test secret") || strings.Contains(status.Body.String(), "access_token") || strings.Contains(status.Body.String(), "refresh_token") {
		t.Fatal("status leaked credentials")
	}
	if !strings.Contains(status.Body.String(), "owner@example.com") {
		t.Fatal("missing connected account")
	}
	if w = call(h, "POST", "/api/drive/disconnect", "{}"); w.Code != 200 || revokes != 1 {
		t.Fatal("disconnect failed")
	}
	if _, err = os.Stat(filepath.Join(d.directory, "drive_tokens.json")); !os.IsNotExist(err) {
		t.Fatal("tokens retained after disconnect")
	}
	if w = call(h, "POST", "/api/drive/backup", "{}"); w.Code != 400 {
		t.Fatal("backup without connection accepted")
	}
}
func TestConfigAndCallbackValidation(t *testing.T) {
	d, h := setup(t)
	input := `{"credentials":{"web":{"client_id":"other.apps.googleusercontent.com","client_secret":"secret","redirect_uris":["http://localhost:3210/api/drive/callback"]}},"redirect_url":"http://localhost:3210/api/drive/callback"}`
	if w := call(h, "PUT", "/api/drive/config", input); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if d.cfg.ClientID != "other.apps.googleusercontent.com" {
		t.Fatal("client config not applied")
	}
	for _, redirect := range []string{"http://remote.example/api/drive/callback", "https://example.com/other", "https://example.com/api/drive/callback?next=evil"} {
		c := d.cfg
		c.RedirectURL = redirect
		if validateConfig(c) == nil {
			t.Fatal("invalid redirect accepted", redirect)
		}
	}
	unlisted := strings.Replace(input, "\"redirect_url\":\"http://localhost:3210/api/drive/callback\"", "\"redirect_url\":\"https://other.example/api/drive/callback\"", 1)
	if w := call(h, "PUT", "/api/drive/config", unlisted); w.Code != 400 {
		t.Fatal("unregistered redirect accepted")
	}
	d.pending["expired"] = pending{Verifier: "test", Expires: time.Now().Add(-time.Minute)}
	r := httptest.NewRequest("GET", "http://localhost:3210/api/drive/callback?state=expired&code=test", nil)
	r.AddCookie(&http.Cookie{Name: "thuchithue_drive_state", Value: "expired"})
	w := httptest.NewRecorder()
	d.Callback(w, r)
	if w.Code != 400 {
		t.Fatal("expired state accepted")
	}
}
func TestUntrustedUploadDestination(t *testing.T) {
	d, _ := setup(t)
	d.auth.AccessToken = "secret token"
	d.auth.Folder.ID = "folder"
	d.client.Transport = roundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "www.googleapis.com" || r.Method != "POST" {
			t.Fatal("token sent outside Google")
		}
		res := response(200, map[string]any{})
		res.Header.Set("Location", "https://evil.example/upload/steal")
		return res, nil
	})
	path := filepath.Join(t.TempDir(), "backup.db")
	os.WriteFile(path, []byte("snapshot"), 0600)
	if _, err := d.upload(context.Background(), path, "backup.db"); err == nil {
		t.Fatal("untrusted upload destination accepted")
	}
}
