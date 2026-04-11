package testutil

import (
	"path/filepath"
	"testing"

	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/migrations"
)

// OpenTestStore opens an in-memory SQLite store for testing.
func OpenTestStore(t *testing.T) *store.Store {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "pinru.db")
	s, err := store.Open(dbPath, migrations.All()...)
	if err != nil {
		t.Fatalf("store.Open() error = %v", err)
	}
	return s
}
