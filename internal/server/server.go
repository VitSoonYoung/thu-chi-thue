package server

import (
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"thuchithue/internal/money"
	"thuchithue/internal/store"
	"thuchithue/internal/tax"
	"time"
)

type Server struct {
	Store   *store.Store
	Handler http.Handler
}
type Category struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	Color      string `json:"color"`
	Kind       string `json:"kind"`
	References int    `json:"references"`
}
type Attachment struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Size int64  `json:"size"`
}
type Transaction struct {
	ID           int64        `json:"id"`
	Amount       string       `json:"amount"`
	USDMinor     string       `json:"usd_minor"`
	ExchangeRate string       `json:"exchange_rate"`
	CategoryID   int64        `json:"category_id"`
	Date         string       `json:"date"`
	Note         string       `json:"note"`
	Deductible   bool         `json:"deductible"`
	Attachments  []Attachment `json:"attachments"`
}

func New(s *store.Store, assets http.Handler) *Server {
	a := &Server{Store: s}
	m := http.NewServeMux()
	m.HandleFunc("GET /api/state", a.state)
	m.HandleFunc("POST /api/transactions", a.saveTransaction)
	m.HandleFunc("PUT /api/transactions/{id}", a.saveTransaction)
	m.HandleFunc("DELETE /api/transactions/{id}", a.deleteTransaction)
	m.HandleFunc("POST /api/categories", a.saveCategory)
	m.HandleFunc("PUT /api/categories/{id}", a.saveCategory)
	m.HandleFunc("DELETE /api/categories/{id}", a.deleteCategory)
	m.HandleFunc("GET /api/attachments/{id}", a.downloadAttachment)
	m.HandleFunc("GET /api/backup/download", a.backup)
	m.HandleFunc("POST /api/restore", a.restore)
	m.HandleFunc("PUT /api/settings", a.settings)
	m.HandleFunc("POST /api/settings/reset", a.resetData)
	m.HandleFunc("GET /api/tax/{year}", a.taxResult)
	m.HandleFunc("POST /api/tax/{year}/preview", a.previewRule)
	m.HandleFunc("POST /api/tax/{year}/rules", a.applyRule)
	m.HandleFunc("POST /api/tax/{year}/lock", a.lockTax)
	m.HandleFunc("POST /api/demo", a.demo)
	m.Handle("/", assets)
	a.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
			if origin := r.Header.Get("Origin"); origin != "" {
				u, e := url.Parse(origin)
				if e != nil || u.Host != r.Host {
					fail(w, 403, "Nguồn yêu cầu không được phép")
					return
				}
			}
			if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
				fail(w, 403, "Nguồn yêu cầu không được phép")
				return
			}
			s.Mu.Lock()
			defer s.Mu.Unlock()
			r.Body = http.MaxBytesReader(w, r.Body, 55<<20)
		}
		m.ServeHTTP(w, r)
	})
	return a
}
func send(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, message string) {
	send(w, status, map[string]string{"error": message})
}
func decode(r *http.Request, v any) error {
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		return errors.New("Dữ liệu gửi lên không hợp lệ")
	}
	if e := d.Decode(&struct{}{}); e != io.EOF {
		return errors.New("Dữ liệu gửi lên không hợp lệ")
	}
	return nil
}
func id(r *http.Request) int64 { v, _ := strconv.ParseInt(r.PathValue("id"), 10, 64); return v }
func (a *Server) state(w http.ResponseWriter, r *http.Request) {
	cats := []Category{}
	rows, e := a.Store.DB.Query("SELECT c.id,c.name,c.color_hex,c.kind,(SELECT count(*) FROM transactions t WHERE t.category_id=c.id) FROM categories c ORDER BY c.id")
	if e != nil {
		fail(w, 500, "Không thể đọc danh mục")
		return
	}
	for rows.Next() {
		var c Category
		if e = rows.Scan(&c.ID, &c.Name, &c.Color, &c.Kind, &c.References); e != nil {
			rows.Close()
			fail(w, 500, "Không thể đọc danh mục")
			return
		}
		cats = append(cats, c)
	}
	rows.Close()
	records, e := a.transactions()
	if e != nil {
		fail(w, 500, "Không thể đọc giao dịch")
		return
	}
	settings := map[string]string{}
	rows, e = a.Store.DB.Query("SELECT key,value FROM settings")
	if e != nil {
		fail(w, 500, "Không thể đọc cài đặt")
		return
	}
	for rows.Next() {
		var k, v string
		rows.Scan(&k, &v)
		settings[k] = v
	}
	rows.Close()
	send(w, 200, map[string]any{"categories": cats, "transactions": records, "settings": settings, "today": a.Store.Now().In(vietnam()).Format("2006-01-02")})
}
func vietnam() *time.Location {
	l, e := time.LoadLocation("Asia/Ho_Chi_Minh")
	if e != nil {
		return time.FixedZone("ICT", 7*3600)
	}
	return l
}
func (a *Server) transactions() ([]Transaction, error) {
	list := []Transaction{}
	rows, e := a.Store.DB.Query("SELECT id,amount_minor,category_id,occurred_at,note,deductible,usd_minor,exchange_rate FROM transactions WHERE deleted_at IS NULL ORDER BY occurred_at DESC,id DESC")
	if e != nil {
		return nil, e
	}
	for rows.Next() {
		var t Transaction
		var amount int64
		var usd, rate sql.NullInt64
		t.Attachments = []Attachment{}
		if e = rows.Scan(&t.ID, &amount, &t.CategoryID, &t.Date, &t.Note, &t.Deductible, &usd, &rate); e != nil {
			rows.Close()
			return nil, e
		}
		t.Amount = strconv.FormatInt(amount, 10)
		if usd.Valid && rate.Valid {
			t.USDMinor = strconv.FormatInt(usd.Int64, 10)
			t.ExchangeRate = strconv.FormatInt(rate.Int64, 10)
		}
		list = append(list, t)
	}
	rows.Close()
	rows, e = a.Store.DB.Query("SELECT id,transaction_id,filename,size_bytes FROM attachments ORDER BY id")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	index := map[int64]int{}
	for i, t := range list {
		index[t.ID] = i
	}
	for rows.Next() {
		var f Attachment
		var tid int64
		if e = rows.Scan(&f.ID, &tid, &f.Name, &f.Size); e != nil {
			return nil, e
		}
		if i, ok := index[tid]; ok {
			list[i].Attachments = append(list[i].Attachments, f)
		}
	}
	return list, rows.Err()
}
func (a *Server) saveTransaction(w http.ResponseWriter, r *http.Request) {
	if e := r.ParseMultipartForm(1 << 20); e != nil {
		fail(w, 400, "Tệp hoặc biểu mẫu quá lớn")
		return
	}
	defer r.MultipartForm.RemoveAll()
	var data struct {
		Amount       string  `json:"amount"`
		USDMinor     string  `json:"usd_minor"`
		ExchangeRate string  `json:"exchange_rate"`
		CategoryID   int64   `json:"category_id"`
		Date         string  `json:"date"`
		Note         string  `json:"note"`
		Deductible   bool    `json:"deductible"`
		RequestID    string  `json:"request_id"`
		Remove       []int64 `json:"remove"`
	}
	if e := json.Unmarshal([]byte(r.FormValue("data")), &data); e != nil {
		fail(w, 400, "Dữ liệu giao dịch không hợp lệ")
		return
	}
	amount, e := strconv.ParseInt(data.Amount, 10, 64)
	if e != nil || amount == 0 {
		fail(w, 400, "Nhập số tiền nguyên khác 0 trong giới hạn VND")
		return
	}
	var usdValue, rateValue any
	if data.USDMinor != "" || data.ExchangeRate != "" {
		converted, cents, rate, conversionError := money.ConvertUSD(data.USDMinor, data.ExchangeRate)
		if conversionError != nil {
			fail(w, 400, conversionError.Error())
			return
		}
		if converted != amount {
			fail(w, 400, "Số tiền VND không khớp với USD và tỷ giá")
			return
		}
		usdValue, rateValue = cents, rate
	}
	if _, e = time.Parse("2006-01-02", data.Date); e != nil {
		fail(w, 400, "Ngày giao dịch không hợp lệ")
		return
	}
	if len(data.Note) > 2000 || len(data.RequestID) < 8 || len(data.RequestID) > 100 {
		fail(w, 400, "Nội dung hoặc mã giao dịch không hợp lệ")
		return
	}
	var kind string
	if e = a.Store.DB.QueryRow("SELECT kind FROM categories WHERE id=?", data.CategoryID).Scan(&kind); e != nil {
		fail(w, 400, "Chọn một danh mục hợp lệ")
		return
	}
	if (kind == "income" && amount < 0) || (kind == "expense" && amount > 0) {
		fail(w, 400, "Danh mục không phù hợp với khoản thu hoặc chi")
		return
	}
	if amount > 0 {
		data.Deductible = false
	}
	tx, e := a.Store.DB.Begin()
	if e != nil {
		fail(w, 500, "Không thể lưu giao dịch")
		return
	}
	defer tx.Rollback()
	tid := id(r)
	old := ""
	if r.Method == "POST" {
		var existing int64
		if e = tx.QueryRow("SELECT id FROM transactions WHERE request_id=?", data.RequestID).Scan(&existing); e == nil {
			send(w, 200, map[string]int64{"id": existing})
			return
		}
		result, e := tx.Exec("INSERT INTO transactions(amount_minor,category_id,occurred_at,note,deductible,created_at,request_id,usd_minor,exchange_rate) VALUES(?,?,?,?,?,?,?,?,?)", amount, data.CategoryID, data.Date, strings.TrimSpace(data.Note), data.Deductible, a.Store.Now().UTC().Format(time.RFC3339), data.RequestID, usdValue, rateValue)
		if e != nil {
			fail(w, 500, "Không thể lưu giao dịch")
			return
		}
		tid, _ = result.LastInsertId()
	} else {
		var previous int64
		if e = tx.QueryRow("SELECT amount_minor FROM transactions WHERE id=? AND deleted_at IS NULL", tid).Scan(&previous); e != nil {
			fail(w, 404, "Giao dịch không tồn tại")
			return
		}
		old = strconv.FormatInt(previous, 10)
		if _, e = tx.Exec("UPDATE transactions SET amount_minor=?,category_id=?,occurred_at=?,note=?,deductible=?,usd_minor=?,exchange_rate=? WHERE id=?", amount, data.CategoryID, data.Date, strings.TrimSpace(data.Note), data.Deductible, usdValue, rateValue, tid); e != nil {
			fail(w, 500, "Không thể cập nhật giao dịch")
			return
		}
	}
	for _, fid := range data.Remove {
		if _, e = tx.Exec("DELETE FROM attachments WHERE id=? AND transaction_id=?", fid, tid); e != nil {
			fail(w, 500, "Không thể xóa chứng từ")
			return
		}
	}
	var existingCount int
	tx.QueryRow("SELECT count(*) FROM attachments WHERE transaction_id=?", tid).Scan(&existingCount)
	files := r.MultipartForm.File["files"]
	if len(files)+existingCount > 5 {
		fail(w, 400, "Mỗi giao dịch được đính kèm tối đa 5 tệp")
		return
	}
	for _, header := range files {
		if header.Size < 1 || header.Size > 10<<20 {
			fail(w, 400, "Mỗi tệp phải có dung lượng từ 1 byte đến 10 MB")
			return
		}
		f, e := header.Open()
		if e != nil {
			fail(w, 400, "Không thể đọc tệp đính kèm")
			return
		}
		content, e := io.ReadAll(io.LimitReader(f, (10<<20)+1))
		f.Close()
		if e != nil || len(content) > 10<<20 {
			fail(w, 400, "Không thể đọc tệp đính kèm")
			return
		}
		mime := http.DetectContentType(content)
		if mime != "application/pdf" && mime != "image/png" && mime != "image/jpeg" {
			fail(w, 400, "Chỉ nhận tệp PDF, JPG hoặc PNG đúng định dạng")
			return
		}
		name := filepath.Base(strings.ReplaceAll(header.Filename, "\\", "/"))
		if len(name) > 240 || strings.ContainsAny(name, "\r\n\x00") {
			fail(w, 400, "Tên tệp không hợp lệ")
			return
		}
		if _, e = tx.Exec("INSERT INTO attachments(transaction_id,filename,mime_type,size_bytes,content_blob,created_at) VALUES(?,?,?,?,?,?)", tid, name, mime, len(content), content, a.Store.Now().UTC().Format(time.RFC3339)); e != nil {
			fail(w, 500, "Không thể lưu chứng từ")
			return
		}
	}
	if e = a.Store.Audit(tx, "save", "transaction:"+strconv.FormatInt(tid, 10), old, r.FormValue("data"), ""); e != nil {
		fail(w, 500, "Không thể ghi lịch sử")
		return
	}
	if e = tx.Commit(); e != nil {
		fail(w, 500, "Không thể lưu giao dịch")
		return
	}
	send(w, 200, map[string]int64{"id": tid})
}
func (a *Server) deleteTransaction(w http.ResponseWriter, r *http.Request) {
	tx, e := a.Store.DB.Begin()
	if e != nil {
		fail(w, 500, "Không thể xóa giao dịch")
		return
	}
	defer tx.Rollback()
	result, e := tx.Exec("UPDATE transactions SET deleted_at=? WHERE id=? AND deleted_at IS NULL", a.Store.Now().UTC().Format(time.RFC3339), id(r))
	if e != nil {
		fail(w, 500, "Không thể xóa giao dịch")
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		fail(w, 404, "Giao dịch không tồn tại")
		return
	}
	if e = a.Store.Audit(tx, "delete", "transaction:"+r.PathValue("id"), "active", "deleted", ""); e != nil {
		fail(w, 500, "Không thể ghi lịch sử")
		return
	}
	if e = tx.Commit(); e != nil {
		fail(w, 500, "Không thể xóa giao dịch")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}

var hex = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func (a *Server) saveCategory(w http.ResponseWriter, r *http.Request) {
	var c struct {
		Name  string `json:"name"`
		Color string `json:"color"`
		Kind  string `json:"kind"`
	}
	if e := decode(r, &c); e != nil {
		fail(w, 400, e.Error())
		return
	}
	c.Name = strings.TrimSpace(c.Name)
	if len([]rune(c.Name)) < 1 || len([]rune(c.Name)) > 60 || !hex.MatchString(c.Color) || (c.Kind != "income" && c.Kind != "expense" && c.Kind != "both") {
		fail(w, 400, "Tên, màu HEX hoặc loại danh mục không hợp lệ")
		return
	}
	rows, e := a.Store.DB.Query("SELECT id,name,kind FROM categories")
	if e != nil {
		fail(w, 500, "Không thể kiểm tra danh mục")
		return
	}
	for rows.Next() {
		var cid int64
		var name, kind string
		rows.Scan(&cid, &name, &kind)
		if cid != id(r) && kind == c.Kind && strings.EqualFold(name, c.Name) {
			rows.Close()
			fail(w, 409, "Tên danh mục đã tồn tại trong loại này")
			return
		}
	}
	rows.Close()
	tx, e := a.Store.DB.Begin()
	if e != nil {
		fail(w, 500, "Không thể lưu danh mục")
		return
	}
	defer tx.Rollback()
	if r.Method == "POST" {
		_, e = tx.Exec("INSERT INTO categories(name,color_hex,kind) VALUES(?,?,?)", c.Name, c.Color, c.Kind)
	} else {
		var conflicting int
		tx.QueryRow("SELECT count(*) FROM transactions WHERE category_id=? AND ((amount_minor>0 AND ?='expense') OR (amount_minor<0 AND ?='income'))", id(r), c.Kind, c.Kind).Scan(&conflicting)
		if conflicting > 0 {
			fail(w, 400, "Loại mới không phù hợp với giao dịch đã lưu")
			return
		}
		var result sql.Result
		result, e = tx.Exec("UPDATE categories SET name=?,color_hex=?,kind=? WHERE id=?", c.Name, c.Color, c.Kind, id(r))
		if e == nil {
			n, _ := result.RowsAffected()
			if n == 0 {
				fail(w, 404, "Danh mục không tồn tại")
				return
			}
		}
	}
	if e != nil {
		fail(w, 409, "Tên danh mục đã tồn tại")
		return
	}
	b, _ := json.Marshal(c)
	if e = a.Store.Audit(tx, "save", "category:"+r.PathValue("id"), "", string(b), ""); e != nil {
		fail(w, 500, "Không thể ghi lịch sử")
		return
	}
	if e = tx.Commit(); e != nil {
		fail(w, 500, "Không thể lưu danh mục")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}
func (a *Server) deleteCategory(w http.ResponseWriter, r *http.Request) {
	result, e := a.Store.DB.Exec("DELETE FROM categories WHERE id=?", id(r))
	if e != nil {
		fail(w, 409, "Danh mục đã có giao dịch, kể cả giao dịch đã xóa")
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		fail(w, 404, "Danh mục không tồn tại")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}
func (a *Server) downloadAttachment(w http.ResponseWriter, r *http.Request) {
	var name, mime string
	var b []byte
	e := a.Store.DB.QueryRow("SELECT filename,mime_type,content_blob FROM attachments WHERE id=?", id(r)).Scan(&name, &mime, &b)
	if e != nil {
		fail(w, 404, "Không tìm thấy chứng từ")
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+url.PathEscape(name))
	w.Write(b)
}
func (a *Server) backup(w http.ResponseWriter, r *http.Request) {
	path, name, e := a.Store.Backup()
	if e != nil {
		log.Printf("backup: %v", e)
		fail(w, 500, "Không thể tạo bản sao lưu")
		return
	}
	defer os.Remove(path)
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	http.ServeFile(w, r, path)
}
func (a *Server) restore(w http.ResponseWriter, r *http.Request) {
	if e := r.ParseMultipartForm(1 << 20); e != nil {
		fail(w, 400, "Bản sao lưu quá lớn hoặc không hợp lệ")
		return
	}
	defer r.MultipartForm.RemoveAll()
	f, _, e := r.FormFile("backup")
	if e != nil {
		fail(w, 400, "Chọn bản sao lưu SQLite")
		return
	}
	defer f.Close()
	temp, e := os.CreateTemp(a.Store.Directory, "restore_*.db")
	if e != nil {
		fail(w, 500, "Không thể đọc bản sao lưu")
		return
	}
	path := temp.Name()
	defer os.Remove(path)
	_, e = io.Copy(temp, f)
	temp.Close()
	if e != nil {
		fail(w, 400, "Không thể đọc bản sao lưu")
		return
	}
	safety, name, e := a.Store.Backup()
	if e != nil {
		fail(w, 500, "Không thể sao lưu dữ liệu hiện tại trước khi khôi phục")
		return
	}
	if e = os.Rename(safety, filepath.Join(a.Store.Directory, "before_restore_"+name)); e != nil {
		os.Remove(safety)
		fail(w, 500, "Không thể giữ bản sao an toàn")
		return
	}
	if e = a.Store.Restore(path); e != nil {
		fail(w, 400, e.Error())
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}
func (a *Server) settings(w http.ResponseWriter, r *http.Request) {
	var data map[string]string
	if e := decode(r, &data); e != nil {
		fail(w, 400, e.Error())
		return
	}
	for k, v := range data {
		switch k {
		case "share_bps":
			n, e := strconv.Atoi(v)
			if e != nil || n < 0 || n > 10000 {
				fail(w, 400, "Tỷ lệ chia không hợp lệ")
				return
			}
		case "usd_rate":
			rate, err := strconv.ParseInt(v, 10, 64)
			if err != nil || rate < 0 || rate > 1_000_000_000 {
				fail(w, 400, "Tỷ giá USD không hợp lệ")
				return
			}
		case "tax_confirmed":
			if v != "true" && v != "false" {
				fail(w, 400, "Trạng thái xác minh không hợp lệ")
				return
			}
		default:
			fail(w, 400, "Cài đặt không hợp lệ")
			return
		}
	}
	tx, e := a.Store.DB.Begin()
	if e != nil {
		fail(w, 500, "Không thể lưu cài đặt")
		return
	}
	defer tx.Rollback()
	for k, v := range data {
		if _, e = tx.Exec("INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", k, v); e != nil {
			fail(w, 500, "Không thể lưu cài đặt")
			return
		}
	}
	if e = tx.Commit(); e != nil {
		fail(w, 500, "Không thể lưu cài đặt")
		return
	}
	send(w, 200, data)
}
func (a *Server) rule(year int) (*tax.Rule, error) {
	var raw string
	e := a.Store.DB.QueryRow("SELECT rule_json FROM tax_rules WHERE year=? ORDER BY version DESC LIMIT 1", year).Scan(&raw)
	if e == sql.ErrNoRows {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	var rule tax.Rule
	e = json.Unmarshal([]byte(raw), &rule)
	return &rule, e
}
func (a *Server) calculate(year int, rule *tax.Rule) (tax.Result, error) {
	list, e := a.transactions()
	if e != nil {
		return tax.Result{}, e
	}
	rev, expenses, cost := new(big.Int), new(big.Int), new(big.Int)
	for _, t := range list {
		if strings.HasPrefix(t.Date, fmt.Sprintf("%04d-", year)) {
			n, _ := new(big.Int).SetString(t.Amount, 10)
			if n.Sign() > 0 {
				rev.Add(rev, n)
			} else {
				n.Abs(n)
				expenses.Add(expenses, n)
				if t.Deductible {
					cost.Add(cost, n)
				}
			}
		}
	}
	var confirmed, shareRaw string
	a.Store.DB.QueryRow("SELECT value FROM settings WHERE key='tax_confirmed'").Scan(&confirmed)
	a.Store.DB.QueryRow("SELECT value FROM settings WHERE key='share_bps'").Scan(&shareRaw)
	share, _ := strconv.ParseInt(shareRaw, 10, 64)
	return tax.Calculate(rule, year, rev.String(), expenses.String(), cost.String(), confirmed == "true", share), nil
}
func year(r *http.Request) int { y, _ := strconv.Atoi(r.PathValue("year")); return y }
func (a *Server) taxResult(w http.ResponseWriter, r *http.Request) {
	y := year(r)
	var snapshot string
	e := a.Store.DB.QueryRow("SELECT snapshot FROM tax_results WHERE year=? AND is_locked=1", y).Scan(&snapshot)
	if e == nil {
		var result tax.Result
		if json.Unmarshal([]byte(snapshot), &result) == nil {
			result.Locked = true
			send(w, 200, result)
			return
		}
	}
	rule, e := a.rule(y)
	if e != nil {
		fail(w, 500, "Không thể đọc quy tắc thuế")
		return
	}
	result, e := a.calculate(y, rule)
	if e != nil {
		fail(w, 500, "Không thể tính thuế")
		return
	}
	send(w, 200, result)
}
func (a *Server) previewRule(w http.ResponseWriter, r *http.Request) {
	var rule tax.Rule
	if e := decode(r, &rule); e != nil {
		fail(w, 400, e.Error())
		return
	}
	if rule.Year != year(r) {
		fail(w, 400, "Năm quy tắc không khớp")
		return
	}
	if e := tax.Validate(rule); e != nil {
		fail(w, 400, e.Error())
		return
	}
	old, e := a.rule(rule.Year)
	if e != nil {
		fail(w, 500, "Không thể đọc quy tắc")
		return
	}
	before, e := a.calculate(rule.Year, old)
	if e != nil {
		fail(w, 500, "Không thể tính thuế")
		return
	}
	after, e := a.calculate(rule.Year, &rule)
	if e != nil {
		fail(w, 500, "Không thể tính thuế")
		return
	}
	send(w, 200, map[string]any{"before": before, "after": after})
}
func (a *Server) applyRule(w http.ResponseWriter, r *http.Request) {
	var rule tax.Rule
	if e := decode(r, &rule); e != nil {
		fail(w, 400, e.Error())
		return
	}
	if rule.Year != year(r) {
		fail(w, 400, "Năm quy tắc không khớp")
		return
	}
	if e := tax.Validate(rule); e != nil {
		fail(w, 400, e.Error())
		return
	}
	old, e := a.rule(rule.Year)
	if e != nil {
		fail(w, 500, "Không thể đọc quy tắc")
		return
	}
	v := 0
	oldRaw := ""
	if old != nil {
		v = old.Version
		b, _ := json.Marshal(old)
		oldRaw = string(b)
	}
	if rule.Version != v {
		fail(w, 409, "Quy tắc đã thay đổi. Hãy tải lại trước khi áp dụng")
		return
	}
	rule.Version = v + 1
	rule.Status = "reference"
	b, _ := json.Marshal(rule)
	tx, e := a.Store.DB.Begin()
	if e != nil {
		fail(w, 500, "Không thể lưu quy tắc")
		return
	}
	defer tx.Rollback()
	if _, e = tx.Exec("INSERT INTO tax_rules VALUES(?,?,?,?,?,?,?)", rule.Year, rule.Version, string(b), rule.Status, rule.EffectiveFrom, rule.VerifiedAt, rule.Reason); e != nil {
		fail(w, 409, "Phiên bản đã tồn tại")
		return
	}
	if e = a.Store.Audit(tx, "apply_rule", fmt.Sprintf("tax:%d", rule.Year), oldRaw, string(b), rule.Reason); e != nil {
		fail(w, 500, "Không thể ghi lịch sử")
		return
	}
	if e = tx.Commit(); e != nil {
		fail(w, 500, "Không thể lưu quy tắc")
		return
	}
	send(w, 200, rule)
}
func (a *Server) lockTax(w http.ResponseWriter, r *http.Request) {
	var data struct {
		Method string `json:"method"`
	}
	if e := decode(r, &data); e != nil {
		fail(w, 400, e.Error())
		return
	}
	rule, e := a.rule(year(r))
	if e != nil || rule == nil {
		fail(w, 400, "Chưa có quy tắc thuế")
		return
	}
	result, e := a.calculate(year(r), rule)
	if e != nil {
		fail(w, 500, "Không thể tính thuế")
		return
	}
	if !result.Confirmed {
		fail(w, 400, "Cần xác nhận cơ sở doanh thu, chi phí và điều kiện áp dụng trong cài đặt")
		return
	}
	if data.Method != "revenue" && data.Method != "profit" {
		fail(w, 400, "Phương pháp không hợp lệ")
		return
	}
	if data.Method == "revenue" && !result.RevenueMethod.Applicable {
		fail(w, 400, "Phương pháp doanh thu không áp dụng")
		return
	}
	result.Method = data.Method
	result.Locked = true
	b, _ := json.Marshal(result)
	tx, e := a.Store.DB.Begin()
	if e != nil {
		fail(w, 500, "Không thể chốt báo cáo")
		return
	}
	defer tx.Rollback()
	if _, e = tx.Exec("INSERT INTO tax_results VALUES(?,?,?,?,1)", year(r), rule.Version, data.Method, string(b)); e != nil {
		fail(w, 409, "Báo cáo năm này đã được chốt")
		return
	}
	if e = a.Store.Audit(tx, "lock_tax", fmt.Sprintf("tax:%d", year(r)), "", string(b), "Người dùng xác nhận phương pháp"); e != nil {
		fail(w, 500, "Không thể ghi lịch sử")
		return
	}
	if e = tx.Commit(); e != nil {
		fail(w, 500, "Không thể chốt báo cáo")
		return
	}
	send(w, 200, result)
}
func (a *Server) demo(w http.ResponseWriter, r *http.Request) {
	var count int
	a.Store.DB.QueryRow("SELECT count(*) FROM transactions").Scan(&count)
	if count > 0 {
		fail(w, 409, "Chỉ nạp dữ liệu mẫu khi chưa có giao dịch")
		return
	}
	tx, e := a.Store.DB.Begin()
	if e != nil {
		fail(w, 500, "Không thể nạp dữ liệu mẫu")
		return
	}
	defer tx.Rollback()
	now := a.Store.Now().In(vietnam())
	date := func(day int) string {
		if day > now.Day() {
			day = now.Day()
		}
		return time.Date(now.Year(), now.Month(), day, 0, 0, 0, 0, vietnam()).Format("2006-01-02")
	}
	for i, t := range []struct {
		amount int64
		cat    int
		day    int
		note   string
	}{{12500000, 1, 15, "Doanh thu Steam"}, {-2400000, 2, 14, "Mua thiết bị"}, {-750000, 3, 12, "Thuê server"}, {-1050000, 3, 10, "Chi phí vận hành"}} {
		if _, e = tx.Exec("INSERT INTO transactions(amount_minor,category_id,occurred_at,note,deductible,created_at,request_id) VALUES(?,?,?,?,?,?,?)", t.amount, t.cat, date(t.day), t.note, t.amount < 0, now.UTC().Format(time.RFC3339), fmt.Sprintf("demo_record_%d", i)); e != nil {
			fail(w, 500, "Không thể nạp dữ liệu mẫu")
			return
		}
	}
	if _, e = tx.Exec("UPDATE settings SET value='true' WHERE key='demo'"); e != nil {
		fail(w, 500, "Không thể nạp dữ liệu mẫu")
		return
	}
	if e = tx.Commit(); e != nil {
		fail(w, 500, "Không thể nạp dữ liệu mẫu")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}

func (a *Server) resetData(w http.ResponseWriter, r *http.Request) {
	var data struct {
		Password string `json:"password"`
	}
	if err := decode(r, &data); err != nil {
		fail(w, 400, err.Error())
		return
	}
	if subtle.ConstantTimeCompare([]byte(data.Password), []byte("TOILACONCHOCUNCUNGGAUGAU")) != 1 {
		fail(w, 403, "Mật khẩu xác nhận không đúng")
		return
	}
	if err := a.Store.Reset(); err != nil {
		log.Printf("data reset: %v", err)
		fail(w, 500, "Không thể hoàn tất xóa dữ liệu. Vui lòng thử lại")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}
