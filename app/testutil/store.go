package testutil

import (
	"path/filepath"
	"testing"

	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/migrations"
)

// OpenTestStore opens a file-backed SQLite store for testing and registers
// t.Cleanup to close it automatically. Tests may still call Close() manually;
// calling it twice is safe because sql.DB.Close is idempotent.
func OpenTestStore(t *testing.T) *store.Store {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "pinru.db")
	s, err := store.Open(dbPath, migrations.All()...)
	if err != nil {
		t.Fatalf("store.Open() error = %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
