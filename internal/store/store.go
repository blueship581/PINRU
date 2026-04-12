package store

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
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
	if err := s.ensureMetaSchema(); err != nil {
		db.Close()
		return nil, err
	}
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

func (s *Store) ensureMetaSchema() error {
	metaTables := []string{
		`CREATE TABLE IF NOT EXISTS schema_migrations (
			id TEXT PRIMARY KEY,
			checksum TEXT NOT NULL,
			statement_count INTEGER NOT NULL,
			applied_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
		)`,
		`CREATE TABLE IF NOT EXISTS schema_repairs (
			repair_key TEXT PRIMARY KEY,
			repair_type TEXT NOT NULL,
			target TEXT NOT NULL,
			definition TEXT NOT NULL,
			applied_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
		)`,
	}

	for _, stmt := range metaTables {
		if _, err := s.DB.Exec(stmt); err != nil {
			return fmt.Errorf("ensure meta schema: %w", err)
		}
	}
	return nil
}

// migrate runs each embedded migration file independently and executes the
// semicolon-separated statements inside a single transaction.
// Already-applied migrations are tracked via schema_migrations and validated by checksum.
// "duplicate column name" errors are silently skipped to make ALTER TABLE ADD COLUMN idempotent.
func (s *Store) migrate(migrationSQL ...string) error {
	for index, sqlText := range migrationSQL {
		migrationID := fmt.Sprintf("migration-%03d", index+1)
		checksum := migrationChecksum(sqlText)

		appliedChecksum, applied, err := s.lookupAppliedMigration(migrationID)
		if err != nil {
			return err
		}
		if applied {
			if appliedChecksum != checksum {
				return fmt.Errorf("migration checksum mismatch: %s", migrationID)
			}
			continue
		}

		statements := splitSQLStatements(sqlText)
		tx, err := s.DB.Begin()
		if err != nil {
			return err
		}
		committed := false
		defer func() {
			if !committed {
				_ = tx.Rollback()
			}
		}()

		for _, stmt := range statements {
			if _, err := tx.Exec(stmt); err != nil {
				if strings.Contains(err.Error(), "duplicate column name") {
					continue
				}
				if isIgnorableCreateIndexError(stmt, err) {
					continue
				}
				return fmt.Errorf("migration exec: %w\nMigration: %s\nSQL: %s", err, migrationID, stmt)
			}
		}

		if _, err := tx.Exec(
			`INSERT INTO schema_migrations (id, checksum, statement_count) VALUES (?, ?, ?)`,
			migrationID, checksum, len(statements),
		); err != nil {
			return fmt.Errorf("record migration %s: %w", migrationID, err)
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		committed = true
	}
	return nil
}

func splitSQLStatements(sqlText string) []string {
	statements := make([]string, 0)

	var current strings.Builder
	inSingleQuote := false
	inDoubleQuote := false
	inBacktick := false
	inLineComment := false
	inBlockComment := false

	for i := 0; i < len(sqlText); i++ {
		ch := sqlText[i]

		if inLineComment {
			if ch == '\n' {
				inLineComment = false
				current.WriteByte(ch)
			}
			continue
		}
		if inBlockComment {
			if ch == '*' && i+1 < len(sqlText) && sqlText[i+1] == '/' {
				inBlockComment = false
				i++
			}
			continue
		}

		if !inSingleQuote && !inDoubleQuote && !inBacktick {
			if ch == '-' && i+1 < len(sqlText) && sqlText[i+1] == '-' {
				inLineComment = true
				i++
				continue
			}
			if ch == '/' && i+1 < len(sqlText) && sqlText[i+1] == '*' {
				inBlockComment = true
				i++
				continue
			}
			if ch == ';' {
				stmt := strings.TrimSpace(current.String())
				if stmt != "" {
					statements = append(statements, stmt)
				}
				current.Reset()
				continue
			}
		}

		current.WriteByte(ch)

		switch ch {
		case '\'':
			if !inDoubleQuote && !inBacktick {
				if inSingleQuote && i+1 < len(sqlText) && sqlText[i+1] == '\'' {
					current.WriteByte(sqlText[i+1])
					i++
					continue
				}
				inSingleQuote = !inSingleQuote
			}
		case '"':
			if !inSingleQuote && !inBacktick {
				if inDoubleQuote && i+1 < len(sqlText) && sqlText[i+1] == '"' {
					current.WriteByte(sqlText[i+1])
					i++
					continue
				}
				inDoubleQuote = !inDoubleQuote
			}
		case '`':
			if !inSingleQuote && !inDoubleQuote {
				inBacktick = !inBacktick
			}
		}
	}

	if stmt := strings.TrimSpace(current.String()); stmt != "" {
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
		{table: "model_runs", column: "session_list", definition: "TEXT NOT NULL DEFAULT '[]'"},
		{table: "model_runs", column: "review_status", definition: "TEXT NOT NULL DEFAULT 'none'"},
		{table: "model_runs", column: "review_round", definition: "INTEGER NOT NULL DEFAULT 0"},
		{table: "model_runs", column: "review_notes", definition: "TEXT"},
		{table: "projects", column: "task_type_quotas", definition: "TEXT NOT NULL DEFAULT '{}'"},
		{table: "projects", column: "task_type_totals", definition: "TEXT NOT NULL DEFAULT '{}'"},
		{table: "projects", column: "source_model_folder", definition: "TEXT NOT NULL DEFAULT 'ORIGIN'"},
		{table: "projects", column: "default_submit_repo", definition: "TEXT NOT NULL DEFAULT ''"},
		{table: "projects", column: "task_types", definition: "TEXT NOT NULL DEFAULT '[]'"},
		{table: "projects", column: "overview_markdown", definition: "TEXT NOT NULL DEFAULT ''"},
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
	if err := s.normalizeDuplicateModelRuns(); err != nil {
		return err
	}

	requiredIndexes := []struct {
		name string
		stmt string
	}{
		{name: "idx_tasks_project_config", stmt: "CREATE INDEX IF NOT EXISTS idx_tasks_project_config ON tasks(project_config_id)"},
		{name: "idx_tasks_status", stmt: "CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)"},
		{name: "idx_model_runs_task", stmt: "CREATE INDEX IF NOT EXISTS idx_model_runs_task ON model_runs(task_id)"},
		{name: "idx_model_runs_task_model", stmt: "CREATE UNIQUE INDEX IF NOT EXISTS idx_model_runs_task_model ON model_runs(task_id, model_name)"},
		{name: "idx_chat_sessions_task", stmt: "CREATE INDEX IF NOT EXISTS idx_chat_sessions_task ON chat_sessions(task_id)"},
		{name: "idx_chat_messages_session", stmt: "CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id)"},
	}

	for _, index := range requiredIndexes {
		exists, err := s.indexExists(index.name)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		if _, err := s.DB.Exec(index.stmt); err != nil {
			return fmt.Errorf("ensure index: %w\nSQL: %s", err, index.stmt)
		}
		if err := s.recordSchemaRepair("index", index.name, index.stmt); err != nil {
			return err
		}
	}

	return nil
}

func (s *Store) normalizeDuplicateModelRuns() error {
	_, err := s.DB.Exec(`
DELETE FROM model_runs
WHERE rowid NOT IN (
	SELECT MAX(rowid)
	FROM model_runs
	GROUP BY task_id, model_name
)`)
	if err != nil {
		return fmt.Errorf("normalize duplicate model runs: %w", err)
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
	return s.recordSchemaRepair("column", table+"."+column, stmt)
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

func migrationChecksum(sqlText string) string {
	sum := sha256.Sum256([]byte(sqlText))
	return hex.EncodeToString(sum[:])
}

func (s *Store) lookupAppliedMigration(id string) (checksum string, applied bool, err error) {
	err = s.DB.QueryRow(
		`SELECT checksum FROM schema_migrations WHERE id = ?`,
		id,
	).Scan(&checksum)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("lookup migration %s: %w", id, err)
	}
	return checksum, true, nil
}

func (s *Store) indexExists(name string) (bool, error) {
	var existing string
	err := s.DB.QueryRow(
		`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`,
		name,
	).Scan(&existing)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("check index %s: %w", name, err)
	}
	return true, nil
}

func (s *Store) recordSchemaRepair(repairType, target, definition string) error {
	repairKey := repairType + ":" + target
	_, err := s.DB.Exec(
		`INSERT INTO schema_repairs (repair_key, repair_type, target, definition) VALUES (?, ?, ?, ?)
		 ON CONFLICT(repair_key) DO NOTHING`,
		repairKey,
		repairType,
		target,
		definition,
	)
	if err != nil {
		return fmt.Errorf("record schema repair %s: %w", repairKey, err)
	}
	return nil
}
