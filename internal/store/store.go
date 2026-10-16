package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	_ "modernc.org/sqlite"
	"os"
	"path/filepath"
	"sync"
	"thuchithue/internal/tax"
	"time"
)

type Store struct {
	DB        *sql.DB
	Mu        sync.Mutex
	Directory string
	Now       func() time.Time
}

var Tables = []string{"categories", "transactions", "attachments", "tax_rules", "tax_results", "settings", "audit_logs"}

const Schema = `
CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE CHECK(length(trim(name)) BETWEEN 1 AND 60), color_hex TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('income','expense','both')), UNIQUE(name,kind)) STRICT;
CREATE TABLE IF NOT EXISTS transactions(id INTEGER PRIMARY KEY, amount_minor INTEGER NOT NULL CHECK(amount_minor!=0), currency TEXT NOT NULL DEFAULT 'VND' CHECK(currency='VND'), category_id INTEGER NOT NULL REFERENCES categories(id), occurred_at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', deductible INTEGER NOT NULL DEFAULT 0 CHECK(deductible IN (0,1)), created_at TEXT NOT NULL, deleted_at TEXT, request_id TEXT NOT NULL UNIQUE) STRICT;
CREATE INDEX IF NOT EXISTS transactions_date ON transactions(occurred_at,deleted_at);
CREATE TABLE IF NOT EXISTS attachments(id INTEGER PRIMARY KEY,transaction_id INTEGER NOT NULL REFERENCES transactions(id),filename TEXT NOT NULL,mime_type TEXT NOT NULL CHECK(mime_type IN ('application/pdf','image/png','image/jpeg')),size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),content_blob BLOB NOT NULL,created_at TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS tax_rules(year INTEGER NOT NULL,version INTEGER NOT NULL,rule_json TEXT NOT NULL,status TEXT NOT NULL,effective_from TEXT NOT NULL,verified_at TEXT NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(year,version)) STRICT;
CREATE TABLE IF NOT EXISTS tax_results(year INTEGER PRIMARY KEY,rule_version INTEGER NOT NULL,method TEXT NOT NULL,snapshot TEXT NOT NULL,is_locked INTEGER NOT NULL CHECK(is_locked IN (0,1))) STRICT;
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY,created_at TEXT NOT NULL,action TEXT NOT NULL,entity TEXT NOT NULL,old_value TEXT NOT NULL,new_value TEXT NOT NULL,reason TEXT NOT NULL) STRICT;
`

func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "finance.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	var tx *sql.Tx
	fail := func(e error) (*Store, error) {
		if tx != nil {
			tx.Rollback()
		}
		db.Close()
		return nil, e
	}
	if _, err = db.Exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;"); err != nil {
		return fail(err)
	}
	var schemaVersion int
	if err = db.QueryRow("PRAGMA user_version").Scan(&schemaVersion); err != nil {
		return fail(err)
	}
	if schemaVersion > 2 {
		return fail(fmt.Errorf("database schema is newer than this application"))
	}
	if _, err = db.Exec(Schema); err != nil {
		return fail(err)
	}
	if err = migrateCurrency(db); err != nil {
		return fail(err)
	}
	s := &Store{DB: db, Directory: dir, Now: time.Now}
	tx, err = db.Begin()
	if err != nil {
		return fail(err)
	}
	defer tx.Rollback()
	var count int
	if err = tx.QueryRow("SELECT count(*) FROM categories").Scan(&count); err != nil {
		return fail(err)
	}
	if count == 0 {
		if _, err = tx.Exec("INSERT INTO categories(name,color_hex,kind) VALUES ('Steam','#249967','income'),('Thiết bị','#e99a42','expense'),('Dịch vụ','#9690c3','expense')"); err != nil {
			return fail(err)
		}
	}
	for _, year := range []int{2026, 2027} {
		r := tax.DefaultRule(year)
		b, _ := json.Marshal(r)
		if _, err = tx.Exec("INSERT OR IGNORE INTO tax_rules VALUES(?,?,?,?,?,?,?)", year, 1, string(b), r.Status, r.EffectiveFrom, r.VerifiedAt, r.Reason); err != nil {
			return fail(err)
		}
	}
	if _, err = tx.Exec("INSERT OR IGNORE INTO settings VALUES('share_bps','7000'),('tax_confirmed','false'),('demo','false'),('usd_rate','25850')"); err != nil {
		return fail(err)
	}
	if _, err = tx.Exec("UPDATE settings SET value='25850' WHERE key='usd_rate' AND value='0'"); err != nil {
		return fail(err)
	}
	if err = tx.Commit(); err != nil {
		return fail(err)
	}
	os.Chmod(path, 0600)
	return s, nil
}
func (s *Store) Audit(tx *sql.Tx, action, entity, old, newValue, reason string) error {
	_, e := tx.Exec("INSERT INTO audit_logs(created_at,action,entity,old_value,new_value,reason) VALUES(?,?,?,?,?,?)", s.Now().UTC().Format(time.RFC3339), action, entity, old, newValue, reason)
	return e
}
func (s *Store) Backup() (string, string, error) {
	loc, err := time.LoadLocation("Asia/Ho_Chi_Minh")
	if err != nil {
		return "", "", err
	}
	f, err := os.CreateTemp(s.Directory, "snapshot_*.db")
	if err != nil {
		return "", "", err
	}
	path := f.Name()
	f.Close()
	os.Remove(path)
	if _, err = s.DB.Exec("VACUUM INTO ?", path); err != nil {
		os.Remove(path)
		return "", "", err
	}
	name := "thuchithue__backup_" + s.Now().In(loc).Format("20060102_150405") + ".db"
	return path, name, nil
}
func (s *Store) Restore(path string) error {
	probe, e := sql.Open("sqlite", path+"?mode=ro")
	if e != nil {
		return fmt.Errorf("Tệp SQLite không hợp lệ")
	}
	defer probe.Close()
	var integrity string
	var version int
	if e = probe.QueryRow("PRAGMA integrity_check").Scan(&integrity); e != nil || integrity != "ok" {
		return fmt.Errorf("Bản sao lưu bị hỏng hoặc không phải SQLite")
	}
	if e = probe.QueryRow("PRAGMA user_version").Scan(&version); e != nil || (version != 1 && version != 2) {
		return fmt.Errorf("Phiên bản bản sao lưu không tương thích")
	}
	rows, e := probe.Query("PRAGMA foreign_key_check")
	if e != nil {
		return e
	}
	bad := rows.Next()
	rows.Close()
	if bad {
		return fmt.Errorf("Bản sao lưu có liên kết dữ liệu không hợp lệ")
	}
	for _, table := range Tables {
		var n int
		if e = probe.QueryRow("SELECT count(*) FROM " + table).Scan(&n); e != nil {
			return fmt.Errorf("Bản sao lưu thiếu dữ liệu %s", table)
		}
	}
	if _, e = s.DB.Exec("ATTACH DATABASE ? AS restored", path); e != nil {
		return e
	}
	defer s.DB.Exec("DETACH DATABASE restored")
	tx, e := s.DB.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	for _, table := range []string{"attachments", "transactions", "categories", "tax_results", "tax_rules", "settings", "audit_logs"} {
		if _, e = tx.Exec("DELETE FROM " + table); e != nil {
			return e
		}
	}
	for _, table := range Tables {
		query := "INSERT INTO " + table + " SELECT * FROM restored." + table
		if table == "transactions" && version == 1 {
			columns := "id,amount_minor,currency,category_id,occurred_at,note,deductible,created_at,deleted_at,request_id"
			query = "INSERT INTO transactions(" + columns + ") SELECT " + columns + " FROM restored.transactions"
		}
		if _, e = tx.Exec(query); e != nil {
			return fmt.Errorf("Không thể khôi phục dữ liệu %s", table)
		}
	}
	if _, e = tx.Exec("INSERT OR IGNORE INTO settings VALUES('usd_rate','25850')"); e != nil {
		return e
	}
	if e = s.Audit(tx, "restore", "database", "", "", "Khôi phục bản sao lưu SQLite"); e != nil {
		return e
	}
	return tx.Commit()
}

func (s *Store) Reset() error {
	if _, err := s.DB.Exec("PRAGMA secure_delete=ON"); err != nil {
		return err
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, table := range []string{"attachments", "transactions", "tax_results", "tax_rules", "categories", "settings", "audit_logs"} {
		if _, err = tx.Exec("DELETE FROM " + table); err != nil {
			return err
		}
	}
	if _, err = tx.Exec("INSERT INTO categories(name,color_hex,kind) VALUES ('Steam','#249967','income'),('Thiết bị','#e99a42','expense'),('Dịch vụ','#9690c3','expense')"); err != nil {
		return err
	}
	for _, year := range []int{2026, 2027} {
		rule := tax.DefaultRule(year)
		raw, err := json.Marshal(rule)
		if err != nil {
			return err
		}
		if _, err = tx.Exec("INSERT INTO tax_rules VALUES(?,?,?,?,?,?,?)", year, 1, string(raw), rule.Status, rule.EffectiveFrom, rule.VerifiedAt, rule.Reason); err != nil {
			return err
		}
	}
	if _, err = tx.Exec("INSERT INTO settings VALUES('share_bps','7000'),('tax_confirmed','false'),('demo','false'),('usd_rate','25850')"); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	if _, err = s.DB.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		return err
	}
	if _, err = s.DB.Exec("VACUUM"); err != nil {
		return err
	}
	if _, err = s.DB.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		return err
	}
	paths, err := filepath.Glob(filepath.Join(s.Directory, "before_restore_thuchithue__backup_*.db"))
	if err != nil {
		return err
	}
	for _, path := range paths {
		if err = os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func migrateCurrency(db *sql.DB) error {
	var version int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version >= 2 {
		return nil
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, query := range []string{
		"ALTER TABLE transactions ADD COLUMN usd_minor INTEGER CHECK(usd_minor IS NULL OR usd_minor != 0)",
		"ALTER TABLE transactions ADD COLUMN exchange_rate INTEGER CHECK(exchange_rate IS NULL OR exchange_rate > 0)",
		"PRAGMA user_version=2",
	} {
		if _, err = tx.Exec(query); err != nil {
			return err
		}
	}
	return tx.Commit()
}
