package drive

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"thuchithue/internal/store"
	"time"
)

const scope = "https://www.googleapis.com/auth/drive.file"
const callbackPath = "/api/drive/callback"

type Config struct {
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
	RedirectURL  string `json:"redirect_url"`
}
type File struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	WebViewLink string `json:"webViewLink"`
	Size        string `json:"size"`
	MD5         string `json:"md5Checksum"`
}
type account struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	Expiry       time.Time `json:"expiry"`
	Email        string    `json:"email"`
	Folder       File      `json:"folder"`
	LastBackup   *File     `json:"last_backup,omitempty"`
	LastBackupAt time.Time `json:"last_backup_at,omitempty"`
}
type pending struct {
	Verifier string
	Expires  time.Time
}
type Drive struct {
	PublicOrigins []string
	mu            sync.Mutex
	cfg           Config
	directory     string
	store         *store.Store
	auth          account
	pending       map[string]pending
	client        *http.Client
}

func New(directory string, s *store.Store, configured *Config) (*Drive, error) {
	d := &Drive{directory: directory, store: s, pending: map[string]pending{}, client: &http.Client{Timeout: 90 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}}
	if configured != nil {
		d.cfg = *configured
	}
	if b, err := os.ReadFile(filepath.Join(directory, "drive_config.json")); err == nil {
		if err = json.Unmarshal(b, &d.cfg); err != nil {
			return nil, fmt.Errorf("invalid Drive config: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if d.cfg.ClientID != "" {
		if err := validateConfig(d.cfg); err != nil {
			return nil, err
		}
	}
	if b, err := os.ReadFile(filepath.Join(directory, "drive_tokens.json")); err == nil {
		if err = json.Unmarshal(b, &d.auth); err != nil {
			return nil, fmt.Errorf("invalid Drive tokens: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	return d, nil
}
func validateConfig(c Config) error {
	u, err := url.Parse(c.RedirectURL)
	if c.ClientID == "" || c.ClientSecret == "" {
		return errors.New("missing Google OAuth client credentials")
	}
	if err != nil || u.Host == "" || u.User != nil || u.Path != callbackPath || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"))) {
		return errors.New("redirect_url must use HTTPS or localhost and end with /api/drive/callback")
	}
	return nil
}
func privateJSON(path string, value any) error {
	b, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".drive.*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(append(b, '\n')); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}
func (d *Drive) save() error {
	return privateJSON(filepath.Join(d.directory, "drive_tokens.json"), d.auth)
}
func random() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func reply(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}
func fail(w http.ResponseWriter, status int, message string) {
	reply(w, status, map[string]string{"error": message})
}
func (d *Drive) Handler() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /api/drive/status", d.status)
	m.HandleFunc("PUT /api/drive/config", d.configure)
	m.HandleFunc("POST /api/drive/connect", d.connect)
	m.HandleFunc("POST /api/drive/backup", d.backup)
	m.HandleFunc("POST /api/drive/disconnect", d.disconnect)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
		m.ServeHTTP(w, r)
	})
}
func (d *Drive) status(w http.ResponseWriter, r *http.Request) {
	d.mu.Lock()
	defer d.mu.Unlock()
	redirect := d.cfg.RedirectURL
	if redirect == "" {
		host := r.Host
		u, _ := url.Parse("http://" + host)
		scheme := "https"
		if u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1" {
			scheme = "http"
		}
		redirect = scheme + "://" + host + callbackPath
		for _, candidate := range d.PublicOrigins {
			public, err := url.Parse(candidate)
			if err == nil && public.Scheme == "https" && public.Hostname() == u.Hostname() {
				redirect = candidate + callbackPath
				break
			}
		}
	}
	origin, _ := url.Parse(redirect)
	reply(w, 200, map[string]any{"configured": d.cfg.ClientID != "", "connected": d.auth.RefreshToken != "", "email": d.auth.Email, "redirect_url": redirect, "connect_origin": origin.Scheme + "://" + origin.Host, "can_connect": r.Host == origin.Host, "folder_url": d.auth.Folder.WebViewLink, "last_backup": d.auth.LastBackup, "last_backup_at": d.auth.LastBackupAt})
}
func (d *Drive) configure(w http.ResponseWriter, r *http.Request) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.auth.RefreshToken != "" {
		fail(w, 409, "Hãy ngắt kết nối trước khi thay đổi thiết lập Google Drive")
		return
	}
	var input struct {
		Credentials json.RawMessage `json:"credentials"`
		RedirectURL string          `json:"redirect_url"`
	}
	if json.NewDecoder(r.Body).Decode(&input) != nil {
		fail(w, 400, "Tệp cấu hình không hợp lệ")
		return
	}
	var downloaded struct {
		Web struct {
			ClientID     string   `json:"client_id"`
			ClientSecret string   `json:"client_secret"`
			RedirectURIs []string `json:"redirect_uris"`
		} `json:"web"`
	}
	if json.Unmarshal(input.Credentials, &downloaded) != nil {
		fail(w, 400, "Tệp OAuth client không hợp lệ")
		return
	}
	c := Config{ClientID: downloaded.Web.ClientID, ClientSecret: downloaded.Web.ClientSecret, RedirectURL: input.RedirectURL}
	if err := validateConfig(c); err != nil {
		fail(w, 400, "Cần OAuth client loại Web application và địa chỉ trả về HTTPS hoặc localhost kết thúc bằng /api/drive/callback")
		return
	}
	allowed := false
	for _, uri := range downloaded.Web.RedirectURIs {
		if uri == c.RedirectURL {
			allowed = true
		}
	}
	if !allowed {
		fail(w, 400, "Địa chỉ trả về chưa có trong tệp OAuth client. Hãy cập nhật Google Cloud rồi tải lại tệp JSON")
		return
	}
	if err := privateJSON(filepath.Join(d.directory, "drive_config.json"), c); err != nil {
		fail(w, 500, "Không thể lưu thiết lập Google Drive")
		return
	}
	d.cfg = c
	d.pending = map[string]pending{}
	reply(w, 200, map[string]bool{"configured": true})
}
func (d *Drive) stateCookie(w http.ResponseWriter, value string, age int) {
	u, _ := url.Parse(d.cfg.RedirectURL)
	http.SetCookie(w, &http.Cookie{Name: "thuchithue_drive_state", Value: value, Path: callbackPath, HttpOnly: true, Secure: u.Scheme == "https", SameSite: http.SameSiteLaxMode, MaxAge: age})
}
func (d *Drive) connect(w http.ResponseWriter, r *http.Request) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.cfg.ClientID == "" {
		fail(w, 400, "Hãy thiết lập OAuth client trước khi kết nối Google Drive")
		return
	}
	origin, _ := url.Parse(d.cfg.RedirectURL)
	if r.Host != origin.Host {
		fail(w, 400, "Hãy mở ứng dụng tại địa chỉ trả về đã cấu hình để kết nối Google Drive")
		return
	}
	for state, p := range d.pending {
		if time.Now().After(p.Expires) {
			delete(d.pending, state)
		}
	}
	if len(d.pending) >= 20 {
		fail(w, 409, "Có phiên kết nối đang chờ. Vui lòng thử lại sau")
		return
	}
	state, verifier := random(), random()
	challenge := sha256.Sum256([]byte(verifier))
	d.pending[state] = pending{Verifier: verifier, Expires: time.Now().Add(10 * time.Minute)}
	values := url.Values{"client_id": {d.cfg.ClientID}, "redirect_uri": {d.cfg.RedirectURL}, "response_type": {"code"}, "scope": {scope}, "access_type": {"offline"}, "prompt": {"consent"}, "state": {state}, "code_challenge": {base64.RawURLEncoding.EncodeToString(challenge[:])}, "code_challenge_method": {"S256"}}
	d.stateCookie(w, state, 600)
	reply(w, 200, map[string]string{"url": "https://accounts.google.com/o/oauth2/v2/auth?" + values.Encode()})
}
func (d *Drive) Callback(w http.ResponseWriter, r *http.Request) {
	d.mu.Lock()
	defer d.mu.Unlock()
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	state := r.URL.Query().Get("state")
	cookie, err := r.Cookie("thuchithue_drive_state")
	p, ok := d.pending[state]
	if err != nil || !ok || time.Now().After(p.Expires) || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(state)) != 1 {
		fail(w, 400, "Phiên kết nối Google Drive không hợp lệ hoặc đã hết hạn. Hãy thử lại trong Cài đặt")
		return
	}
	origin, _ := url.Parse(d.cfg.RedirectURL)
	if r.Host != origin.Host {
		fail(w, 400, "Địa chỉ trả về không hợp lệ")
		return
	}
	delete(d.pending, state)
	d.stateCookie(w, "", -1)
	result := "error"
	if r.URL.Query().Get("error") == "" && r.URL.Query().Get("code") != "" {
		values := url.Values{"code": {r.URL.Query().Get("code")}, "client_id": {d.cfg.ClientID}, "client_secret": {d.cfg.ClientSecret}, "redirect_uri": {d.cfg.RedirectURL}, "grant_type": {"authorization_code"}, "code_verifier": {p.Verifier}}
		previous := d.auth
		d.auth = account{}
		if err = d.exchange(r.Context(), values); err == nil && d.auth.RefreshToken != "" {
			var about struct {
				User struct {
					Email string `json:"emailAddress"`
				} `json:"user"`
			}
			if err = d.api(r.Context(), "GET", "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", nil, &about); err == nil {
				d.auth.Email = about.User.Email
				if d.save() == nil {
					result = "connected"
				}
			}
		}
		if result != "connected" {
			d.auth = previous
		}
	}
	http.Redirect(w, r, origin.Scheme+"://"+origin.Host+"/?drive="+result, http.StatusSeeOther)
}
func (d *Drive) exchange(ctx context.Context, values url.Values) error {
	req, err := http.NewRequestWithContext(ctx, "POST", "https://oauth2.googleapis.com/token", strings.NewReader(values.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := d.client.Do(req)
	if err != nil {
		return errors.New("Không thể kết nối tới Google. Vui lòng thử lại")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return errors.New("Google Drive chưa được cấp quyền hoặc phiên kết nối đã hết hạn. Hãy kết nối lại")
	}
	var token struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		Scope        string `json:"scope"`
	}
	if err = json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&token); err != nil || token.AccessToken == "" {
		return errors.New("Google trả về phiên kết nối không hợp lệ")
	}
	if token.Scope != "" && !strings.Contains(" "+token.Scope+" ", " "+scope+" ") {
		return errors.New("Google chưa cấp quyền sao lưu tệp")
	}
	d.auth.AccessToken = token.AccessToken
	if token.RefreshToken != "" {
		d.auth.RefreshToken = token.RefreshToken
	}
	d.auth.Expiry = time.Now().Add(time.Duration(token.ExpiresIn) * time.Second)
	return nil
}
func (d *Drive) ensureToken(ctx context.Context) error {
	if d.auth.RefreshToken == "" {
		return errors.New("Hãy kết nối Google Drive trước khi sao lưu")
	}
	if d.auth.AccessToken != "" && d.auth.Expiry.After(time.Now().Add(time.Minute)) {
		return nil
	}
	if err := d.exchange(ctx, url.Values{"client_id": {d.cfg.ClientID}, "client_secret": {d.cfg.ClientSecret}, "refresh_token": {d.auth.RefreshToken}, "grant_type": {"refresh_token"}}); err != nil {
		return err
	}
	return d.save()
}
func (d *Drive) api(ctx context.Context, method, endpoint string, body any, target any) error {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+d.auth.AccessToken)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := d.client.Do(req)
	if err != nil {
		return errors.New("Không thể kết nối tới Google Drive")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("Google Drive không thể thực hiện thao tác (HTTP %d). Kiểm tra quyền truy cập, dung lượng và kết nối", res.StatusCode)
	}
	if target != nil {
		return json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(target)
	}
	return nil
}
func (d *Drive) folder(ctx context.Context) error {
	if d.auth.Folder.ID != "" {
		return nil
	}
	q := "mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key='thuchithue' and value='backups' }"
	var list struct {
		Files []File `json:"files"`
	}
	if err := d.api(ctx, "GET", "https://www.googleapis.com/drive/v3/files?"+url.Values{"q": {q}, "fields": {"files(id,name,webViewLink)"}, "pageSize": {"1"}}.Encode(), nil, &list); err != nil {
		return err
	}
	if len(list.Files) > 0 {
		d.auth.Folder = list.Files[0]
	} else {
		if err := d.api(ctx, "POST", "https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink", map[string]any{"name": "Thu Chi & Thuế Backups", "mimeType": "application/vnd.google-apps.folder", "appProperties": map[string]string{"thuchithue": "backups"}}, &d.auth.Folder); err != nil {
			return err
		}
	}
	if d.auth.Folder.ID == "" {
		return errors.New("Không thể xác nhận thư mục sao lưu")
	}
	return d.save()
}
func (d *Drive) upload(ctx context.Context, path, name string) (File, error) {
	var result File
	f, err := os.Open(path)
	if err != nil {
		return result, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return result, err
	}
	hash := md5.New()
	if _, err = io.Copy(hash, f); err != nil {
		return result, err
	}
	checksum := hex.EncodeToString(hash.Sum(nil))
	if _, err = f.Seek(0, io.SeekStart); err != nil {
		return result, err
	}
	metadata, _ := json.Marshal(map[string]any{"name": name, "parents": []string{d.auth.Folder.ID}, "appProperties": map[string]string{"thuchithue": "sqlite_backup"}})
	req, err := http.NewRequestWithContext(ctx, "POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,size,md5Checksum", bytes.NewReader(metadata))
	if err != nil {
		return result, err
	}
	req.Header.Set("Authorization", "Bearer "+d.auth.AccessToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Upload-Content-Type", "application/x-sqlite3")
	req.Header.Set("X-Upload-Content-Length", strconv.FormatInt(info.Size(), 10))
	res, err := d.client.Do(req)
	if err != nil {
		return result, errors.New("Không thể bắt đầu tải bản sao lưu lên Google Drive")
	}
	location := res.Header.Get("Location")
	res.Body.Close()
	endpoint, parseErr := url.Parse(location)
	if res.StatusCode != 200 || parseErr != nil || endpoint.Scheme != "https" || endpoint.Host != "www.googleapis.com" || !strings.HasPrefix(endpoint.Path, "/upload/") {
		return result, errors.New("Google Drive không trả về địa chỉ tải lên hợp lệ")
	}
	req, err = http.NewRequestWithContext(ctx, "PUT", location, f)
	if err != nil {
		return result, err
	}
	req.ContentLength = info.Size()
	req.Header.Set("Content-Type", "application/x-sqlite3")
	req.Header.Set("Authorization", "Bearer "+d.auth.AccessToken)
	res, err = d.client.Do(req)
	if err != nil {
		return result, errors.New("Tải lên bị gián đoạn. Hãy kiểm tra Google Drive trước khi thử lại")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return result, fmt.Errorf("Google Drive từ chối bản sao lưu (HTTP %d)", res.StatusCode)
	}
	if err = json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&result); err != nil {
		return result, err
	}
	if result.ID == "" || result.Size != strconv.FormatInt(info.Size(), 10) || result.MD5 != checksum {
		return result, errors.New("Không thể xác nhận tính toàn vẹn bản sao lưu trên Google Drive")
	}
	return result, nil
}
func (d *Drive) backup(w http.ResponseWriter, r *http.Request) {
	d.mu.Lock()
	defer d.mu.Unlock()
	ctx, cancel := context.WithTimeout(r.Context(), 110*time.Second)
	defer cancel()
	if err := d.ensureToken(ctx); err != nil {
		fail(w, 400, err.Error())
		return
	}
	if err := d.folder(ctx); err != nil {
		fail(w, 502, err.Error())
		return
	}
	d.store.Mu.Lock()
	path, name, err := d.store.Backup()
	d.store.Mu.Unlock()
	if err != nil {
		fail(w, 500, "Không thể tạo bản sao lưu SQLite")
		return
	}
	defer os.Remove(path)
	file, err := d.upload(ctx, path, name)
	if err != nil {
		fail(w, 502, err.Error())
		return
	}
	d.auth.LastBackup = &file
	d.auth.LastBackupAt = time.Now().UTC()
	if err = d.save(); err != nil {
		fail(w, 500, "Đã tải lên Google Drive nhưng không thể lưu trạng thái trên máy chủ")
		return
	}
	reply(w, 200, map[string]any{"file": file, "uploaded_at": d.auth.LastBackupAt})
}
func (d *Drive) disconnect(w http.ResponseWriter, r *http.Request) {
	d.mu.Lock()
	defer d.mu.Unlock()
	revoked := d.auth.RefreshToken == ""
	if !revoked {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		req, _ := http.NewRequestWithContext(ctx, "POST", "https://oauth2.googleapis.com/revoke", strings.NewReader(url.Values{"token": {d.auth.RefreshToken}}.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		if res, err := d.client.Do(req); err == nil {
			revoked = res.StatusCode == 200 || res.StatusCode == 400
			res.Body.Close()
		}
	}
	if err := os.Remove(filepath.Join(d.directory, "drive_tokens.json")); err != nil && !errors.Is(err, os.ErrNotExist) {
		fail(w, 500, "Không thể xóa phiên kết nối trên máy chủ")
		return
	}
	d.auth = account{}
	d.pending = map[string]pending{}
	reply(w, 200, map[string]bool{"disconnected": true, "revoked": revoked})
}
