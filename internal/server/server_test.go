package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"thuchithue/internal/store"
	"thuchithue/internal/tax"
	"time"
)

func setup(t *testing.T) (*Server, *store.Store) {
	t.Helper()
	s, e := store.Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.DB.Close() })
	s.Now = func() time.Time { return time.Date(2026, 10, 15, 14, 21, 0, 0, time.UTC) }
	return New(s, http.NotFoundHandler()), s
}
func request(a *Server, method, path string, body io.Reader, content string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://127.0.0.1:8080"+path, body)
	if content != "" {
		r.Header.Set("Content-Type", content)
	}
	w := httptest.NewRecorder()
	a.Handler.ServeHTTP(w, r)
	return w
}
func transaction(t *testing.T, a *Server, path, method, amount, key string, category int, content []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	data := fmt.Sprintf(`{"amount":%q,"category_id":%d,"date":"2026-10-15","note":"Test transaction","deductible":true,"request_id":%q,"remove":[]}`, amount, category, key)
	writer.WriteField("data", data)
	if content != nil {
		f, e := writer.CreateFormFile("files", "invoice.pdf")
		if e != nil {
			t.Fatal(e)
		}
		f.Write(content)
	}
	writer.Close()
	return request(a, method, path, &body, writer.FormDataContentType())
}
func TestTransactionsAndCategories(t *testing.T) {
	a, s := setup(t)
	for _, amount := range []string{"0", "9223372036854775808", "abc"} {
		if w := transaction(t, a, "/api/transactions", "POST", amount, "invalid_record", 1, nil); w.Code != 400 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if w := transaction(t, a, "/api/transactions", "POST", "-50", "wrong_category", 1, nil); w.Code != 400 {
		t.Fatal("category kind")
	}
	for i := 0; i < 2; i++ {
		if w := transaction(t, a, "/api/transactions", "POST", "12500000", "idempotent_record", 1, nil); w.Code != 200 {
			t.Fatal(w.Body.String())
		}
	}
	var count int
	s.DB.QueryRow("SELECT count(*) FROM transactions").Scan(&count)
	if count != 1 {
		t.Fatal("duplicate submission")
	}
	if w := transaction(t, a, "/api/transactions/1", "PUT", "15000000", "update_record", 1, nil); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := request(a, "DELETE", "/api/transactions/1", nil, ""); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := request(a, "DELETE", "/api/categories/1", nil, ""); w.Code != 409 {
		t.Fatal("soft deletion must retain references")
	}
	for _, raw := range []string{`{"name":"","color":"#123456","kind":"both"}`, `{"name":"Test","color":"invalid","kind":"both"}`, `{"name":"sTEAM","color":"#123456","kind":"income"}`} {
		w := request(a, "POST", "/api/categories", strings.NewReader(raw), "application/json")
		if w.Code < 400 {
			t.Fatal("invalid category accepted")
		}
	}
	if w := request(a, "POST", "/api/categories", strings.NewReader(`{"name":"Tiết kiệm","color":"#123456","kind":"both"}`), "application/json"); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := request(a, "DELETE", "/api/categories/4", nil, ""); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	records, e := a.transactions()
	if e != nil || len(records) != 0 {
		t.Fatal("deleted record visible")
	}
}
func TestBackupRestoreWithAttachments(t *testing.T) {
	a, s := setup(t)
	content := []byte("%PDF-1.4\nLocal invoice\n%%EOF")
	if w := transaction(t, a, "/api/transactions", "POST", "-2400000", "attachment_record", 2, content); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	w := request(a, "GET", "/api/backup/download", nil, "")
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w.Header().Get("Content-Type") != "application/octet-stream" {
		t.Fatal("backup MIME")
	}
	if w.Header().Get("Content-Disposition") != `attachment; filename="thuchithue__backup_20261015_212100.db"` {
		t.Fatal(w.Header())
	}
	path := filepath.Join(t.TempDir(), "backup.db")
	if e := os.WriteFile(path, w.Body.Bytes(), 0600); e != nil {
		t.Fatal(e)
	}
	request(a, "DELETE", "/api/transactions/1", nil, "")
	if e := s.Restore(path); e != nil {
		t.Fatal(e)
	}
	records, e := a.transactions()
	if e != nil || len(records) != 1 || len(records[0].Attachments) != 1 {
		t.Fatalf("restore: %+v %v", records, e)
	}
	file := request(a, "GET", "/api/attachments/1", nil, "")
	if !bytes.Equal(file.Body.Bytes(), content) {
		t.Fatal("attachment content lost")
	}
	var check string
	s.DB.QueryRow("PRAGMA integrity_check").Scan(&check)
	if check != "ok" {
		t.Fatal(check)
	}
	bad := filepath.Join(t.TempDir(), "bad.db")
	os.WriteFile(bad, []byte("not a database"), 0600)
	if s.Restore(bad) == nil {
		t.Fatal("invalid restore accepted")
	}
	records, _ = a.transactions()
	if len(records) != 1 {
		t.Fatal("invalid restore modified data")
	}
}
func TestFilesAndOrigin(t *testing.T) {
	a, _ := setup(t)
	w := transaction(t, a, "/api/transactions", "POST", "-10", "unsafe_attachment", 2, []byte("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))
	if w.Code != 400 {
		t.Fatal("unsafe attachment")
	}
	for _, origin := range []string{"https://evil.example", "http://localhost:8081"} {
		r := httptest.NewRequest("GET", "http://127.0.0.1:8080/api/backup/download", nil)
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		a.Handler.ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatal("cross origin backup")
		}
	}

}
func TestRulePreviewVersioningAndSnapshot(t *testing.T) {
	a, s := setup(t)
	if w := transaction(t, a, "/api/transactions", "POST", "1500000000", "tax_revenue_record", 1, nil); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	request(a, "PUT", "/api/settings", strings.NewReader(`{"tax_confirmed":"true","share_bps":"7000"}`), "application/json")
	rule := tax.DefaultRule(2026)
	rule.RevenueBPS = 600
	rule.Reason = "Test new annual rate"
	b, _ := json.Marshal(rule)
	w := request(a, "POST", "/api/tax/2026/preview", bytes.NewReader(b), "application/json")
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	latest, _ := a.rule(2026)
	if latest.Version != 1 {
		t.Fatal("preview changed database")
	}
	w = request(a, "POST", "/api/tax/2026/lock", strings.NewReader(`{"method":"revenue"}`), "application/json")
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w = request(a, "POST", "/api/tax/2026/rules", bytes.NewReader(b), "application/json"); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	latest, _ = a.rule(2026)
	if latest.Version != 2 {
		t.Fatal("version not created")
	}
	if w = request(a, "POST", "/api/tax/2026/rules", bytes.NewReader(b), "application/json"); w.Code != 409 {
		t.Fatal("concurrent write accepted")
	}
	w = request(a, "GET", "/api/tax/2026", nil, "")
	var result tax.Result
	json.Unmarshal(w.Body.Bytes(), &result)
	if !result.Locked || result.Rule.Version != 1 || result.RevenueMethod.Total != "17500000" {
		t.Fatalf("snapshot changed: %+v", result)
	}
	var logs int
	s.DB.QueryRow("SELECT count(*) FROM audit_logs WHERE action='apply_rule'").Scan(&logs)
	if logs != 1 {
		t.Fatal("rule audit missing")
	}
}
func TestPersistentStateAndTotals(t *testing.T) {
	a, s := setup(t)
	if w := request(a, "POST", "/api/demo", strings.NewReader("{}"), "application/json"); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	rule, _ := a.rule(2026)
	got, e := a.calculate(2026, rule)
	if e != nil || got.Revenue != "12500000" || got.Expenses != "4200000" {
		t.Fatalf("totals: %+v %v", got, e)
	}
	dir := s.Directory
	s.DB.Close()
	reopened, e := store.Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer reopened.DB.Close()
	var count int
	reopened.DB.QueryRow("SELECT count(*) FROM transactions").Scan(&count)
	if count != 4 {
		t.Fatal("restart lost transactions")
	}
}

func TestResetRequiresExactPasswordAndClearsStoredData(t *testing.T) {
	a, s := setup(t)
	content := []byte("%PDF-1.4\nReset test receipt\n%%EOF")
	if w := transaction(t, a, "/api/transactions", "POST", "-2400000", "reset_test_record", 2, content); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if _, e := s.DB.Exec("INSERT INTO categories(name,color_hex,kind) VALUES('Custom category','#123456','both'); UPDATE settings SET value='6500' WHERE key='share_bps'; INSERT INTO tax_results VALUES(2026,1,'profit','{}',1); INSERT INTO tax_rules SELECT year,2,rule_json,status,effective_from,verified_at,reason FROM tax_rules WHERE year=2026 AND version=1;"); e != nil {
		t.Fatal(e)
	}
	automatic := filepath.Join(s.Directory, "before_restore_thuchithue__backup_20261015_212100.db")
	unrelated := filepath.Join(s.Directory, "my_downloaded_backup.db")
	for _, path := range []string{automatic, unrelated} {
		if e := os.WriteFile(path, []byte("backup fixture"), 0600); e != nil {
			t.Fatal(e)
		}
	}
	for _, password := range []string{"", "wrong", "toilaconchocuncunggaugau", "TOILACONCHOCUNCUNGGAUGAU "} {
		body, _ := json.Marshal(map[string]string{"password": password})
		w := request(a, "POST", "/api/settings/reset", bytes.NewReader(body), "application/json")
		if w.Code != 403 {
			t.Fatal("incorrect confirmation accepted", w.Code)
		}
		var n int
		s.DB.QueryRow("SELECT count(*) FROM transactions").Scan(&n)
		if n != 1 {
			t.Fatal("wrong password erased data")
		}
	}
	w := request(a, "POST", "/api/settings/reset", strings.NewReader(`{"password":"TOILACONCHOCUNCUNGGAUGAU"}`), "application/json")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	for table, want := range map[string]int{"transactions": 0, "attachments": 0, "tax_results": 0, "audit_logs": 0, "categories": 3, "tax_rules": 2, "settings": 4} {
		var n int
		if e := s.DB.QueryRow("SELECT count(*) FROM " + table).Scan(&n); e != nil || n != want {
			t.Fatalf("%s: got %d want %d error %v", table, n, want, e)
		}
	}
	var share, integrity string
	s.DB.QueryRow("SELECT value FROM settings WHERE key='share_bps'").Scan(&share)
	if share != "7000" {
		t.Fatal("settings not reset")
	}
	s.DB.QueryRow("PRAGMA integrity_check").Scan(&integrity)
	if integrity != "ok" {
		t.Fatal(integrity)
	}
	if _, e := os.Stat(automatic); !os.IsNotExist(e) {
		t.Fatal("automatic backup retained")
	}
	if _, e := os.Stat(unrelated); e != nil {
		t.Fatal("unrelated backup removed")
	}
	dir := s.Directory
	s.DB.Close()
	reopened, e := store.Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer reopened.DB.Close()
	var n int
	reopened.DB.QueryRow("SELECT count(*) FROM transactions").Scan(&n)
	if n != 0 {
		t.Fatal("reset did not persist")
	}
}

func TestUSDPersistenceValidationAndBackup(t *testing.T) {
	a, s := setup(t)
	save := func(method, path, amount, usd, rate, key string) *httptest.ResponseRecorder {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		raw, _ := json.Marshal(map[string]any{"amount": amount, "usd_minor": usd, "exchange_rate": rate, "request_id": key, "category_id": 1, "date": "2026-10-15", "note": "USD receipt", "deductible": false, "remove": []int{}})
		writer.WriteField("data", string(raw))
		writer.Close()
		return request(a, method, path, &body, writer.FormDataContentType())
	}
	for i, values := range [][3]string{{"2512501", "10050", "25000"}, {"2512500", "10050", "0"}, {"2512500", "", "25000"}, {"2512500", "10050", ""}} {
		if w := save("POST", "/api/transactions", values[0], values[1], values[2], fmt.Sprintf("invalid_usd_%d", i)); w.Code != 400 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if w := save("POST", "/api/transactions", "2512500", "10050", "25000", "usd_record_1"); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	list, e := a.transactions()
	if e != nil || len(list) != 1 || list[0].USDMinor != "10050" || list[0].ExchangeRate != "25000" {
		t.Fatal(list, e)
	}
	if w := request(a, "PUT", "/api/settings", strings.NewReader(`{"usd_rate":"26000"}`), "application/json"); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	list, _ = a.transactions()
	if list[0].Amount != "2512500" || list[0].ExchangeRate != "25000" {
		t.Fatal("rate update rewrote transaction")
	}
	backup, _, e := s.Backup()
	if e != nil {
		t.Fatal(e)
	}
	if w := save("PUT", "/api/transactions/1", "3000000", "", "", "usd_edit_native"); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	list, _ = a.transactions()
	if list[0].USDMinor != "" || list[0].ExchangeRate != "" {
		t.Fatal("native edit retained stale USD")
	}
	if e = s.Restore(backup); e != nil {
		t.Fatal(e)
	}
	list, _ = a.transactions()
	if list[0].USDMinor != "10050" || list[0].ExchangeRate != "25000" || list[0].Amount != "2512500" {
		t.Fatal("USD backup lost metadata")
	}
}

func TestPrivateNetworkAccess(t *testing.T) {
	a, _ := setup(t)
	for _, host := range []string{"finance.example.ts.net:3210", "192.168.1.10:3210", "100.100.100.100:3210"} {
		r := httptest.NewRequest("GET", "http://"+host+"/api/state", nil)
		r.RemoteAddr = "192.168.1.2:1234"
		r.Header.Set("Origin", "http://"+host)
		w := httptest.NewRecorder()
		a.Handler.ServeHTTP(w, r)
		if w.Code != 200 {
			t.Fatalf("host %s: got %d", host, w.Code)
		}
	}
}
