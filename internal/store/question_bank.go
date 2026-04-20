package store

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/blueship581/pinru/internal/errs"
)

type QuestionBankItem struct {
	ProjectConfigID string  `json:"projectConfigId"`
	QuestionID      int64   `json:"questionId"`
	DisplayName     string  `json:"displayName"`
	SourceKind      string  `json:"sourceKind"`
	SourcePath      string  `json:"sourcePath"`
	ArchivePath     *string `json:"archivePath"`
	OriginRef       string  `json:"originRef"`
	Status          string  `json:"status"`
	ErrorMessage    *string `json:"errorMessage"`
	CreatedAt       int64   `json:"createdAt"`
	UpdatedAt       int64   `json:"updatedAt"`
}

func (s *Store) ListQuestionBankItems(projectConfigID string) ([]QuestionBankItem, error) {
	projectConfigID = strings.TrimSpace(projectConfigID)
	if projectConfigID == "" {
		return nil, fmt.Errorf(errs.MsgProjectConfigIDReq)
	}

	rows, err := s.DB.Query(
		fmt.Sprintf(
			`SELECT project_config_id, question_id, display_name, source_kind, source_path, archive_path,
			        origin_ref, status, error_message, %s, %s
			   FROM question_bank_items
			  WHERE project_config_id = ?
			  ORDER BY updated_at DESC, question_id ASC`,
			unixTimestampExpr("created_at"),
			unixTimestampExpr("updated_at"),
		),
		projectConfigID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]QuestionBankItem, 0)
	for rows.Next() {
		var item QuestionBankItem
		if err := rows.Scan(
			&item.ProjectConfigID,
			&item.QuestionID,
			&item.DisplayName,
			&item.SourceKind,
			&item.SourcePath,
			&item.ArchivePath,
			&item.OriginRef,
			&item.Status,
			&item.ErrorMessage,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) GetQuestionBankItem(projectConfigID string, questionID int64) (*QuestionBankItem, error) {
	projectConfigID = strings.TrimSpace(projectConfigID)
	if projectConfigID == "" {
		return nil, fmt.Errorf(errs.MsgProjectConfigIDReq)
	}

	var item QuestionBankItem
	err := s.DB.QueryRow(
		fmt.Sprintf(
			`SELECT project_config_id, question_id, display_name, source_kind, source_path, archive_path,
			        origin_ref, status, error_message, %s, %s
			   FROM question_bank_items
			  WHERE project_config_id = ? AND question_id = ?`,
			unixTimestampExpr("created_at"),
			unixTimestampExpr("updated_at"),
		),
		projectConfigID,
		questionID,
	).Scan(
		&item.ProjectConfigID,
		&item.QuestionID,
		&item.DisplayName,
		&item.SourceKind,
		&item.SourcePath,
		&item.ArchivePath,
		&item.OriginRef,
		&item.Status,
		&item.ErrorMessage,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (s *Store) UpsertQuestionBankItem(item QuestionBankItem) error {
	projectConfigID := strings.TrimSpace(item.ProjectConfigID)
	if projectConfigID == "" {
		return fmt.Errorf(errs.MsgProjectConfigIDReq)
	}
	now := time.Now().Unix()

	_, err := s.DB.Exec(
		`INSERT INTO question_bank_items (
		    project_config_id, question_id, display_name, source_kind, source_path, archive_path,
		    origin_ref, status, error_message, created_at, updated_at
		  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		  ON CONFLICT(project_config_id, question_id) DO UPDATE SET
		    display_name=excluded.display_name,
		    source_kind=excluded.source_kind,
		    source_path=excluded.source_path,
		    archive_path=excluded.archive_path,
		    origin_ref=excluded.origin_ref,
		    status=excluded.status,
		    error_message=excluded.error_message,
		    updated_at=excluded.updated_at`,
		projectConfigID,
		item.QuestionID,
		strings.TrimSpace(item.DisplayName),
		strings.TrimSpace(item.SourceKind),
		strings.TrimSpace(item.SourcePath),
		item.ArchivePath,
		strings.TrimSpace(item.OriginRef),
		firstNonEmpty(strings.TrimSpace(item.Status), "ready"),
		item.ErrorMessage,
		now,
		now,
	)
	return err
}

func (s *Store) DeleteQuestionBankItem(projectConfigID string, questionID int64) error {
	projectConfigID = strings.TrimSpace(projectConfigID)
	if projectConfigID == "" {
		return fmt.Errorf(errs.MsgProjectConfigIDReq)
	}
	_, err := s.DB.Exec(
		`DELETE FROM question_bank_items WHERE project_config_id = ? AND question_id = ?`,
		projectConfigID,
		questionID,
	)
	return err
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
