package store

import (
	"database/sql"
	"sync"
	"testing"
	"time"
)

func TestWALBackupDuringWrites(t *testing.T) {
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.DB.Close()
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 30; i++ {
			if _, e := s.DB.Exec("INSERT INTO audit_logs(created_at,action,entity,old_value,new_value,reason) VALUES(?,?,?,?,?,?)", time.Now().Format(time.RFC3339), "test", "test", "", "", ""); e != nil {
				t.Error(e)
			}
		}
	}()
	path, _, e := s.Backup()
	if e != nil {
		t.Fatal(e)
	}
	wg.Wait()
	snapshot, e := sql.Open("sqlite", path)
	if e != nil {
		t.Fatal(e)
	}
	defer snapshot.Close()
	var integrity string
	if e = snapshot.QueryRow("PRAGMA integrity_check").Scan(&integrity); e != nil || integrity != "ok" {
		t.Fatal(integrity, e)
	}
}

func TestLegacyCurrencyMigrationAndRestore(t *testing.T) {
	dir := t.TempDir()
	s, e := Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.DB.Exec("INSERT INTO transactions(amount_minor,category_id,occurred_at,note,deductible,created_at,request_id) VALUES(-100000,2,'2024-07-01','Legacy record',0,'2024-07-01','legacy_record'); ALTER TABLE transactions DROP COLUMN usd_minor; ALTER TABLE transactions DROP COLUMN exchange_rate; DELETE FROM settings WHERE key='usd_rate'; PRAGMA user_version=1;"); e != nil {
		t.Fatal(e)
	}
	legacy, _, e := s.Backup()
	if e != nil {
		t.Fatal(e)
	}
	s.DB.Close()
	upgraded, e := Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer upgraded.DB.Close()
	var version int
	upgraded.DB.QueryRow("PRAGMA user_version").Scan(&version)
	if version != 2 {
		t.Fatal(version)
	}
	var amount int64
	var usd sql.NullInt64
	if e = upgraded.DB.QueryRow("SELECT amount_minor,usd_minor FROM transactions WHERE request_id='legacy_record'").Scan(&amount, &usd); e != nil || amount != -100000 || usd.Valid {
		t.Fatal(amount, usd, e)
	}
	if e = upgraded.Restore(legacy); e != nil {
		t.Fatal(e)
	}
	if e = upgraded.DB.QueryRow("SELECT amount_minor,usd_minor FROM transactions WHERE request_id='legacy_record'").Scan(&amount, &usd); e != nil || amount != -100000 || usd.Valid {
		t.Fatal("legacy restore failed", e)
	}
	upgraded.DB.Close()
	again, e := Open(dir)
	if e != nil {
		t.Fatal("migration not idempotent", e)
	}
	again.DB.Close()
}
