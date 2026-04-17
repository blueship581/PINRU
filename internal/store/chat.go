package store

import (
	"strings"

	"github.com/blueship581/pinru/internal/errs"
	"github.com/google/uuid"
)

type ChatSession struct {
	ID        string `json:"id"`
	TaskID    string `json:"taskId"`
	Title     string `json:"title"`
	Model     string `json:"model"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

type ChatMessage struct {
	ID        string `json:"id"`
	SessionID string `json:"sessionId"`
	Role      string `json:"role"` // "user" | "assistant"
	Content   string `json:"content"`
	CreatedAt int64  `json:"createdAt"`
}

func (s *Store) CreateChatSession(taskID, title, model string) (*ChatSession, error) {
	id := uuid.New().String()
	_, err := s.DB.Exec(
		`INSERT INTO chat_sessions (id, task_id, title, model) VALUES (?, ?, ?, ?)`,
		id, taskID, title, model,
	)
	if err != nil {
		return nil, err
	}
	return s.GetChatSession(id)
}

func (s *Store) GetChatSession(id string) (*ChatSession, error) {
	row := s.DB.QueryRow(
		`SELECT id, task_id, title, model, created_at, updated_at FROM chat_sessions WHERE id = ?`, id,
	)
	var sess ChatSession
	if err := row.Scan(&sess.ID, &sess.TaskID, &sess.Title, &sess.Model, &sess.CreatedAt, &sess.UpdatedAt); err != nil {
		return nil, err
	}
	return &sess, nil
}

func (s *Store) ListChatSessions(taskID, model string) ([]ChatSession, error) {
	query := `SELECT id, task_id, title, model, created_at, updated_at
		FROM chat_sessions WHERE task_id = ?`
	args := []any{taskID}
	if trimmedModel := strings.TrimSpace(model); trimmedModel != "" {
		query += ` AND model = ?`
		args = append(args, trimmedModel)
	}
	query += ` ORDER BY updated_at DESC`

	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []ChatSession
	for rows.Next() {
		var sess ChatSession
		if err := rows.Scan(&sess.ID, &sess.TaskID, &sess.Title, &sess.Model, &sess.CreatedAt, &sess.UpdatedAt); err != nil {
			return nil, err
		}
		sessions = append(sessions, sess)
	}
	return sessions, rows.Err()
}

func (s *Store) UpdateChatSessionTitle(id, title string) error {
	res, err := s.DB.Exec(
		`UPDATE chat_sessions SET title = ?, updated_at = strftime('%s','now') WHERE id = ?`, title, id,
	)
	return ensureRowsAffected(res, err, errs.FmtStoreChatSessionNotFound, id)
}

func (s *Store) UpdateChatSessionModel(id, model string) error {
	res, err := s.DB.Exec(
		`UPDATE chat_sessions SET model = ?, updated_at = strftime('%s','now') WHERE id = ?`, model, id,
	)
	return ensureRowsAffected(res, err, errs.FmtStoreChatSessionNotFound, id)
}

func (s *Store) TouchChatSession(id string) error {
	res, err := s.DB.Exec(
		`UPDATE chat_sessions SET updated_at = strftime('%s','now') WHERE id = ?`, id,
	)
	return ensureRowsAffected(res, err, errs.FmtStoreChatSessionNotFound, id)
}

func (s *Store) DeleteChatSession(id string) error {
	res, err := s.DB.Exec(`DELETE FROM chat_sessions WHERE id = ?`, id)
	return ensureRowsAffected(res, err, errs.FmtStoreChatSessionNotFound, id)
}

func (s *Store) AddChatMessage(sessionID, role, content string) (*ChatMessage, error) {
	id := uuid.New().String()
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	if _, err := tx.Exec(
		`INSERT INTO chat_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)`,
		id, sessionID, role, content,
	); err != nil {
		return nil, err
	}

	res, err := tx.Exec(
		`UPDATE chat_sessions SET updated_at = strftime('%s','now') WHERE id = ?`, sessionID,
	)
	if err := ensureRowsAffected(res, err, errs.FmtStoreChatSessionNotFound, sessionID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	committed = true
	return s.GetChatMessage(id)
}

func (s *Store) GetChatMessage(id string) (*ChatMessage, error) {
	row := s.DB.QueryRow(
		`SELECT id, session_id, role, content, created_at FROM chat_messages WHERE id = ?`, id,
	)
	var msg ChatMessage
	if err := row.Scan(&msg.ID, &msg.SessionID, &msg.Role, &msg.Content, &msg.CreatedAt); err != nil {
		return nil, err
	}
	return &msg, nil
}

func (s *Store) ListChatMessages(sessionID string) ([]ChatMessage, error) {
	rows, err := s.DB.Query(
		`SELECT id, session_id, role, content, created_at
		   FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC`, sessionID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var msgs []ChatMessage
	for rows.Next() {
		var msg ChatMessage
		if err := rows.Scan(&msg.ID, &msg.SessionID, &msg.Role, &msg.Content, &msg.CreatedAt); err != nil {
			return nil, err
		}
		msgs = append(msgs, msg)
	}
	return msgs, rows.Err()
}

func (s *Store) UpdateChatMessage(id, content string) error {
	res, err := s.DB.Exec(`UPDATE chat_messages SET content = ? WHERE id = ?`, content, id)
	return ensureRowsAffected(res, err, errs.FmtStoreChatMessageNotFound, id)
}

func (s *Store) DeleteChatMessage(id string) error {
	res, err := s.DB.Exec(`DELETE FROM chat_messages WHERE id = ?`, id)
	return ensureRowsAffected(res, err, errs.FmtStoreChatMessageNotFound, id)
}
