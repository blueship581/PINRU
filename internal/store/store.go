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

func Open(dbPath string, migrationSQL ...string) (*Store, error) {
	os.MkdirAll(filepath.Dir(dbPath), 0755)
	db, err := sql.Open("sqlite", dbPath+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}
	s := &Store{DB: db}
	if err := s.migrate(migrationSQL...); err != nil {
		db.Close()
		return nil, err
	}
	if err := s.ensureSchema(); err != nil {
		db.Close()
		return nil, err
	}
	if err := s.migrateLegacyConfigs(); err != nil {
		db.Close()
		return nil, err
	}
	if err := s.backfillProjectTaskTypeTotals(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.DB.Close() }

// migrate runs each embedded migration file independently and executes the
// semicolon-separated statements after removing comment-only lines.
// Convention: migration files must not use semicolons inside string literals.
// "duplicate column name" errors are silently skipped to make ALTER TABLE ADD COLUMN idempotent.
func (s *Store) migrate(migrationSQL ...string) error {
	for _, sqlText := range migrationSQL {
		for _, stmt := range splitSQLStatements(sqlText) {
			if _, err := s.DB.Exec(stmt); err != nil {
				// Ignore "duplicate column name" — migration already applied
				if strings.Contains(err.Error(), "duplicate column name") {
					continue
				}
				if isIgnorableCreateIndexError(stmt, err) {
					continue
				}
				return fmt.Errorf("migration exec: %w\nSQL: %s", err, stmt)
			}
		}
	}
	return nil
}

func splitSQLStatements(sqlText string) []string {
	cleanedLines := make([]string, 0)
	for _, line := range strings.Split(sqlText, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "--") {
			continue
		}
		cleanedLines = append(cleanedLines, line)
	}

	statements := make([]string, 0)
	for _, stmt := range strings.Split(strings.Join(cleanedLines, "\n"), ";") {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		statements = append(statements, stmt)
	}

	return statements
}

func (s *Store) ensureSchema() error {
	requiredColumns := []struct {
		table      string
		column     string
		definition string
	}{
		{table: "tasks", column: "project_config_id", definition: "TEXT"},
		{table: "tasks", column: "task_type", definition: "TEXT NOT NULL DEFAULT '" + defaultTaskType + "'"},
		{table: "tasks", column: "session_list", definition: "TEXT NOT NULL DEFAULT '[]'"},
		{table: "tasks", column: "prompt_generation_status", definition: "TEXT NOT NULL DEFAULT 'idle'"},
		{table: "tasks", column: "prompt_generation_error", definition: "TEXT"},
		{table: "tasks", column: "prompt_generation_started_at", definition: "INTEGER"},
		{table: "tasks", column: "prompt_generation_finished_at", definition: "INTEGER"},
		{table: "projects", column: "task_type_quotas", definition: "TEXT NOT NULL DEFAULT '{}'"},
		{table: "projects", column: "task_type_totals", definition: "TEXT NOT NULL DEFAULT '{}'"},
		{table: "projects", column: "source_model_folder", definition: "TEXT NOT NULL DEFAULT 'ORIGIN'"},
		{table: "projects", column: "default_submit_repo", definition: "TEXT NOT NULL DEFAULT ''"},
		{table: "projects", column: "task_types", definition: "TEXT NOT NULL DEFAULT '[]'"},
	}

	for _, column := range requiredColumns {
		if err := s.ensureColumn(column.table, column.column, column.definition); err != nil {
			return err
		}
	}

	if err := s.ensureIndexes(); err != nil {
		return err
	}

	return nil
}

func (s *Store) ensureIndexes() error {
	requiredIndexes := []string{
		"CREATE INDEX IF NOT EXISTS idx_tasks_project_config ON tasks(project_config_id)",
		"CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)",
		"CREATE INDEX IF NOT EXISTS idx_model_runs_task ON model_runs(task_id)",
		"CREATE INDEX IF NOT EXISTS idx_chat_sessions_task ON chat_sessions(task_id)",
		"CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id)",
	}

	for _, stmt := range requiredIndexes {
		if _, err := s.DB.Exec(stmt); err != nil {
			return fmt.Errorf("ensure index: %w\nSQL: %s", err, stmt)
		}
	}

	return nil
}

func (s *Store) ensureColumn(table, column, definition string) error {
	exists, err := s.columnExists(table, column)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}

	stmt := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, definition)
	if _, err := s.DB.Exec(stmt); err != nil {
		if strings.Contains(err.Error(), "duplicate column name") {
			return nil
		}
		return fmt.Errorf("ensure column %s.%s: %w", table, column, err)
	}
	return nil
}

func (s *Store) columnExists(table, column string) (bool, error) {
	rows, err := s.DB.Query(fmt.Sprintf("PRAGMA table_info(%s)", table))
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid        int
			name       string
			columnType string
			notNull    int
			defaultVal sql.NullString
			primaryKey int
		)
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultVal, &primaryKey); err != nil {
			return false, err
		}
		if strings.EqualFold(name, column) {
			return true, nil
		}
	}

	return false, rows.Err()
}

func isIgnorableCreateIndexError(stmt string, err error) bool {
	normalizedStmt := strings.ToUpper(strings.TrimSpace(stmt))
	if !strings.HasPrefix(normalizedStmt, "CREATE INDEX") && !strings.HasPrefix(normalizedStmt, "CREATE UNIQUE INDEX") {
		return false
	}

	return strings.Contains(err.Error(), "no such column")
}
