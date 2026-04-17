package store

import (
	"database/sql"
	"strings"

	"github.com/blueship581/pinru/internal/errs"
)

const defaultAiReviewIssueType = "Bug修复"

type AiReviewNode struct {
	ID                string  `json:"id"`
	TaskID            string  `json:"taskId"`
	ModelRunID        *string `json:"modelRunId"`
	ParentID          *string `json:"parentId"`
	RootID            string  `json:"rootId"`
	ModelName         string  `json:"modelName"`
	LocalPath         string  `json:"localPath"`
	Title             string  `json:"title"`
	IssueType         string  `json:"issueType"`
	Level             int     `json:"level"`
	Sequence          int     `json:"sequence"`
	Status            string  `json:"status"`
	RunCount          int     `json:"runCount"`
	OriginalPrompt    string  `json:"originalPrompt"`
	PromptText        string  `json:"promptText"`
	ReviewNotes       string  `json:"reviewNotes"`
	ParentReviewNotes string  `json:"parentReviewNotes"`
	NextPrompt        string  `json:"nextPrompt"`
	IsCompleted       *bool   `json:"isCompleted"`
	IsSatisfied       *bool   `json:"isSatisfied"`
	ProjectType       string  `json:"projectType"`
	ChangeScope       string  `json:"changeScope"`
	KeyLocations      string  `json:"keyLocations"`
	LastJobID         *string `json:"lastJobId"`
	IsActive          bool    `json:"isActive"`
	CreatedAt         int64   `json:"createdAt"`
	UpdatedAt         int64   `json:"updatedAt"`
}

func (s *Store) ListAiReviewNodes(taskID string) ([]AiReviewNode, error) {
	rows, err := s.DB.Query(
		`SELECT id, task_id, model_run_id, parent_id, root_id, model_name, local_path,
		        title, issue_type, level, sequence, status, run_count, original_prompt,
		        prompt_text, review_notes, parent_review_notes, next_prompt,
		        is_completed, is_satisfied, project_type, change_scope, key_locations,
		        last_job_id, is_active, created_at, updated_at
		   FROM ai_review_nodes
		  WHERE task_id = ? AND is_active = 1
		  ORDER BY created_at ASC, level ASC, sequence ASC`,
		taskID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var nodes []AiReviewNode
	for rows.Next() {
		node, err := scanAiReviewNode(rows)
		if err != nil {
			return nil, err
		}
		nodes = append(nodes, node)
	}
	return nodes, rows.Err()
}

func (s *Store) ListAiReviewNodesByModelRun(modelRunID string) ([]AiReviewNode, error) {
	rows, err := s.DB.Query(
		`SELECT id, task_id, model_run_id, parent_id, root_id, model_name, local_path,
		        title, issue_type, level, sequence, status, run_count, original_prompt,
		        prompt_text, review_notes, parent_review_notes, next_prompt,
		        is_completed, is_satisfied, project_type, change_scope, key_locations,
		        last_job_id, is_active, created_at, updated_at
		   FROM ai_review_nodes
		  WHERE model_run_id = ? AND is_active = 1
		  ORDER BY created_at ASC, level ASC, sequence ASC`,
		modelRunID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var nodes []AiReviewNode
	for rows.Next() {
		node, err := scanAiReviewNode(rows)
		if err != nil {
			return nil, err
		}
		nodes = append(nodes, node)
	}
	return nodes, rows.Err()
}

func (s *Store) GetAiReviewNode(id string) (*AiReviewNode, error) {
	row := s.DB.QueryRow(
		`SELECT id, task_id, model_run_id, parent_id, root_id, model_name, local_path,
		        title, issue_type, level, sequence, status, run_count, original_prompt,
		        prompt_text, review_notes, parent_review_notes, next_prompt,
		        is_completed, is_satisfied, project_type, change_scope, key_locations,
		        last_job_id, is_active, created_at, updated_at
		   FROM ai_review_nodes
		  WHERE id = ?`,
		id,
	)

	node, err := scanAiReviewNode(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &node, nil
}

func (s *Store) FindActiveAiReviewRoot(taskID string, modelRunID *string, localPath string) (*AiReviewNode, error) {
	query := `SELECT id, task_id, model_run_id, parent_id, root_id, model_name, local_path,
	                 title, issue_type, level, sequence, status, run_count, original_prompt,
	                 prompt_text, review_notes, parent_review_notes, next_prompt,
	                 is_completed, is_satisfied, project_type, change_scope, key_locations,
	                 last_job_id, is_active, created_at, updated_at
	            FROM ai_review_nodes
	           WHERE task_id = ? AND parent_id IS NULL AND is_active = 1`
	args := []any{taskID}

	if modelRunID != nil && strings.TrimSpace(*modelRunID) != "" {
		query += ` AND model_run_id = ? ORDER BY updated_at DESC LIMIT 1`
		args = append(args, strings.TrimSpace(*modelRunID))
	} else {
		query += ` AND model_run_id IS NULL AND local_path = ? ORDER BY updated_at DESC LIMIT 1`
		args = append(args, strings.TrimSpace(localPath))
	}

	row := s.DB.QueryRow(query, args...)
	node, err := scanAiReviewNode(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &node, nil
}

func (s *Store) CreateAiReviewNode(node AiReviewNode) error {
	if strings.TrimSpace(node.IssueType) == "" {
		node.IssueType = defaultAiReviewIssueType
	}
	if node.Level <= 0 {
		node.Level = 1
	}
	_, err := s.DB.Exec(
		`INSERT INTO ai_review_nodes (
			id, task_id, model_run_id, parent_id, root_id, model_name, local_path,
			title, issue_type, level, sequence, status, run_count, original_prompt,
			prompt_text, review_notes, parent_review_notes, next_prompt,
			is_completed, is_satisfied, project_type, change_scope, key_locations,
			last_job_id, is_active
		) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		node.ID, node.TaskID, node.ModelRunID, node.ParentID, node.RootID, node.ModelName, node.LocalPath,
		node.Title, node.IssueType, node.Level, node.Sequence, node.Status, node.RunCount, node.OriginalPrompt,
		node.PromptText, node.ReviewNotes, node.ParentReviewNotes, node.NextPrompt,
		boolPtrToNullableInt(node.IsCompleted), boolPtrToNullableInt(node.IsSatisfied),
		node.ProjectType, node.ChangeScope, node.KeyLocations, node.LastJobID, boolToInt(node.IsActive),
	)
	return err
}

func (s *Store) SaveAiReviewNode(node AiReviewNode) error {
	if strings.TrimSpace(node.IssueType) == "" {
		node.IssueType = defaultAiReviewIssueType
	}
	res, err := s.DB.Exec(
		`UPDATE ai_review_nodes
		    SET task_id = ?, model_run_id = ?, parent_id = ?, root_id = ?, model_name = ?, local_path = ?,
		        title = ?, issue_type = ?, level = ?, sequence = ?, status = ?, run_count = ?,
		        original_prompt = ?, prompt_text = ?, review_notes = ?, parent_review_notes = ?, next_prompt = ?,
		        is_completed = ?, is_satisfied = ?, project_type = ?, change_scope = ?, key_locations = ?,
		        last_job_id = ?, is_active = ?, updated_at = strftime('%s','now')
		  WHERE id = ?`,
		node.TaskID, node.ModelRunID, node.ParentID, node.RootID, node.ModelName, node.LocalPath,
		node.Title, node.IssueType, node.Level, node.Sequence, node.Status, node.RunCount,
		node.OriginalPrompt, node.PromptText, node.ReviewNotes, node.ParentReviewNotes, node.NextPrompt,
		boolPtrToNullableInt(node.IsCompleted), boolPtrToNullableInt(node.IsSatisfied),
		node.ProjectType, node.ChangeScope, node.KeyLocations, node.LastJobID, boolToInt(node.IsActive), node.ID,
	)
	return ensureRowsAffected(res, err, errs.FmtStoreReviewNodeNotFound, node.ID)
}

func (s *Store) UpdateAiReviewNodeEditableFields(id, title, issueType, promptText, reviewNotes string) error {
	if strings.TrimSpace(issueType) == "" {
		issueType = defaultAiReviewIssueType
	}
	res, err := s.DB.Exec(
		`UPDATE ai_review_nodes
		    SET title = ?, issue_type = ?, prompt_text = ?, review_notes = ?, updated_at = strftime('%s','now')
		  WHERE id = ?`,
		title, issueType, promptText, reviewNotes, id,
	)
	return ensureRowsAffected(res, err, errs.FmtStoreReviewNodeNotFound, id)
}

func scanAiReviewNode(scanner interface {
	Scan(dest ...any) error
}) (AiReviewNode, error) {
	var (
		node           AiReviewNode
		isCompletedRaw sql.NullInt64
		isSatisfiedRaw sql.NullInt64
		isActiveRaw    int
	)
	err := scanner.Scan(
		&node.ID, &node.TaskID, &node.ModelRunID, &node.ParentID, &node.RootID, &node.ModelName, &node.LocalPath,
		&node.Title, &node.IssueType, &node.Level, &node.Sequence, &node.Status, &node.RunCount, &node.OriginalPrompt,
		&node.PromptText, &node.ReviewNotes, &node.ParentReviewNotes, &node.NextPrompt,
		&isCompletedRaw, &isSatisfiedRaw, &node.ProjectType, &node.ChangeScope, &node.KeyLocations,
		&node.LastJobID, &isActiveRaw, &node.CreatedAt, &node.UpdatedAt,
	)
	if err != nil {
		return AiReviewNode{}, err
	}
	node.IsCompleted = nullableIntToBoolPtr(isCompletedRaw)
	node.IsSatisfied = nullableIntToBoolPtr(isSatisfiedRaw)
	node.IsActive = isActiveRaw != 0
	return node, nil
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func boolPtrToNullableInt(value *bool) any {
	if value == nil {
		return nil
	}
	if *value {
		return 1
	}
	return 0
}

func nullableIntToBoolPtr(value sql.NullInt64) *bool {
	if !value.Valid {
		return nil
	}
	result := value.Int64 != 0
	return &result
}

func SummarizeAiReviewNodes(nodes []AiReviewNode) (status string, round int, notes *string) {
	if len(nodes) == 0 {
		return "none", 0, nil
	}

	childrenByParent := make(map[string]int, len(nodes))
	totalRuns := 0
	anyRunning := false

	for _, node := range nodes {
		totalRuns += max(node.RunCount, 0)
		if node.Status == "running" {
			anyRunning = true
		}
		if node.ParentID != nil && strings.TrimSpace(*node.ParentID) != "" {
			childrenByParent[strings.TrimSpace(*node.ParentID)]++
		}
	}

	if totalRuns <= 0 {
		totalRuns = 1
	}

	if anyRunning {
		return "running", totalRuns, buildAiReviewSummaryNotes(nodes, childrenByParent)
	}

	allNone := true
	for _, node := range nodes {
		if node.Status != "none" {
			allNone = false
			break
		}
	}
	if allNone {
		return "none", 0, nil
	}

	for _, node := range nodes {
		if childrenByParent[node.ID] > 0 {
			continue
		}
		if node.Status != "pass" {
			return "warning", totalRuns, buildAiReviewSummaryNotes(nodes, childrenByParent)
		}
	}

	return "pass", totalRuns, nil
}

func buildAiReviewSummaryNotes(nodes []AiReviewNode, childrenByParent map[string]int) *string {
	parts := make([]string, 0, 3)
	for _, node := range nodes {
		if childrenByParent[node.ID] > 0 || node.Status == "pass" {
			continue
		}
		text := strings.TrimSpace(node.ReviewNotes)
		title := strings.TrimSpace(node.Title)
		switch {
		case text != "":
			parts = append(parts, text)
		case title != "":
			parts = append(parts, title)
		}
		if len(parts) >= 3 {
			break
		}
	}
	if len(parts) == 0 {
		return nil
	}
	summary := strings.Join(parts, "；")
	return &summary
}
