package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

type Store struct{ DB *sql.DB }

func Open(dbPath string, migrationSQL string) (*Store, error) {
	os.MkdirAll(filepath.Dir(dbPath), 0755)
	db, err := sql.Open("sqlite", dbPath+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}
	s := &Store{DB: db}
	if err := s.migrate(migrationSQL); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.DB.Close() }

// migrate runs each semicolon-separated SQL statement.
// Convention: migration files must not use semicolons inside comments or string literals.
// "duplicate column name" errors are silently skipped to make ALTER TABLE ADD COLUMN idempotent.
func (s *Store) migrate(sqlText string) error {
	for _, stmt := range strings.Split(sqlText, ";") {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		if _, err := s.DB.Exec(stmt); err != nil {
			// Ignore "duplicate column name" — migration already applied
			if strings.Contains(err.Error(), "duplicate column name") {
				continue
			}
			return fmt.Errorf("migration exec: %w\nSQL: %s", err, stmt)
		}
	}
	return nil
}
