package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const (
	defaultSourceModelFolder = "ORIGIN"
	defaultProjectTaskTypes  = "[]"
	defaultProjectQuotas     = "{}"
)

type Project struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	GitLabURL         string `json:"gitlabUrl"`
	GitLabToken       string `json:"gitlabToken"`
	CloneBasePath     string `json:"cloneBasePath"`
	Models            string `json:"models"`
	SourceModelFolder string `json:"sourceModelFolder"`
	DefaultSubmitRepo string `json:"defaultSubmitRepo"`
	TaskTypes         string `json:"taskTypes"`
	TaskTypeQuotas    string `json:"taskTypeQuotas"`
	CreatedAt         int64  `json:"createdAt"`
	UpdatedAt         int64  `json:"updatedAt"`
}

type projectScanner interface {
	Scan(dest ...any) error
}

type projectColumnSet struct {
	SourceModelFolder bool
	DefaultSubmitRepo bool
	TaskTypes         bool
	TaskTypeQuotas    bool
}

func (s *Store) loadProjectColumnSet() (projectColumnSet, error) {
	var columns projectColumnSet
	var err error

	if columns.SourceModelFolder, err = s.columnExists("projects", "source_model_folder"); err != nil {
		return columns, err
	}
	if columns.DefaultSubmitRepo, err = s.columnExists("projects", "default_submit_repo"); err != nil {
		return columns, err
	}
	if columns.TaskTypes, err = s.columnExists("projects", "task_types"); err != nil {
		return columns, err
	}
	if columns.TaskTypeQuotas, err = s.columnExists("projects", "task_type_quotas"); err != nil {
		return columns, err
	}

	return columns, nil
}

func projectSelectExpr(exists bool, column, fallback string) string {
	if exists {
		return fmt.Sprintf("COALESCE(NULLIF(%s, ''), %s) AS %s", column, fallback, column)
	}
	return fmt.Sprintf("%s AS %s", fallback, column)
}

func (s *Store) projectSelectQuery(suffix string) (string, error) {
	columns, err := s.loadProjectColumnSet()
	if err != nil {
		return "", err
	}

	query := fmt.Sprintf(
		"SELECT id, name, gitlab_url, gitlab_token, clone_base_path, models, %s, %s, %s, %s, created_at, updated_at FROM projects",
		projectSelectExpr(columns.SourceModelFolder, "source_model_folder", "'"+defaultSourceModelFolder+"'"),
		projectSelectExpr(columns.DefaultSubmitRepo, "default_submit_repo", "''"),
		projectSelectExpr(columns.TaskTypes, "task_types", "'"+defaultProjectTaskTypes+"'"),
		projectSelectExpr(columns.TaskTypeQuotas, "task_type_quotas", "'"+defaultProjectQuotas+"'"),
	)
	if suffix != "" {
		query += " " + suffix
	}
	return query, nil
}

func scanProject(scanner projectScanner) (*Project, error) {
	var p Project
	if err := scanner.Scan(
		&p.ID,
		&p.Name,
		&p.GitLabURL,
		&p.GitLabToken,
		&p.CloneBasePath,
		&p.Models,
		&p.SourceModelFolder,
		&p.DefaultSubmitRepo,
		&p.TaskTypes,
		&p.TaskTypeQuotas,
		&p.CreatedAt,
		&p.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &p, nil
}

func normalizeProjectPayload(p Project) (string, string, string) {
	sourceModelFolder := strings.TrimSpace(p.SourceModelFolder)
	if sourceModelFolder == "" {
		sourceModelFolder = defaultSourceModelFolder
	}

	taskTypes := strings.TrimSpace(p.TaskTypes)
	if taskTypes == "" {
		taskTypes = defaultProjectTaskTypes
	}

	quotas := strings.TrimSpace(p.TaskTypeQuotas)
	if quotas == "" {
		quotas = defaultProjectQuotas
	}

	return sourceModelFolder, taskTypes, quotas
}

func (s *Store) ListProjects() ([]Project, error) {
	query, err := s.projectSelectQuery("ORDER BY created_at DESC")
	if err != nil {
		return nil, err
	}

	rows, err := s.DB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	projects := make([]Project, 0)
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		projects = append(projects, *p)
	}
	return projects, rows.Err()
}

func (s *Store) GetProject(id string) (*Project, error) {
	query, err := s.projectSelectQuery("WHERE id = ?")
	if err != nil {
		return nil, err
	}

	p, err := scanProject(s.DB.QueryRow(query, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return p, err
}

func (s *Store) CreateProject(p Project) error {
	now := time.Now().Unix()
	sourceModelFolder, taskTypes, quotas := normalizeProjectPayload(p)

	columns, err := s.loadProjectColumnSet()
	if err != nil {
		return err
	}

	columnNames := []string{
		"id",
		"name",
		"gitlab_url",
		"gitlab_token",
		"clone_base_path",
		"models",
	}
	values := []any{
		p.ID,
		p.Name,
		p.GitLabURL,
		p.GitLabToken,
		p.CloneBasePath,
		p.Models,
	}

	if columns.SourceModelFolder {
		columnNames = append(columnNames, "source_model_folder")
		values = append(values, sourceModelFolder)
	}
	if columns.DefaultSubmitRepo {
		columnNames = append(columnNames, "default_submit_repo")
		values = append(values, strings.TrimSpace(p.DefaultSubmitRepo))
	}
	if columns.TaskTypes {
		columnNames = append(columnNames, "task_types")
		values = append(values, taskTypes)
	}
	if columns.TaskTypeQuotas {
		columnNames = append(columnNames, "task_type_quotas")
		values = append(values, quotas)
	}

	columnNames = append(columnNames, "created_at", "updated_at")
	values = append(values, now, now)

	placeholders := make([]string, len(columnNames))
	for i := range placeholders {
		placeholders[i] = "?"
	}

	stmt := fmt.Sprintf(
		"INSERT INTO projects (%s) VALUES (%s)",
		strings.Join(columnNames, ", "),
		strings.Join(placeholders, ", "),
	)
	_, err = s.DB.Exec(stmt, values...)
	return err
}

func (s *Store) UpdateProject(p Project) error {
	now := time.Now().Unix()
	sourceModelFolder, taskTypes, quotas := normalizeProjectPayload(p)

	columns, err := s.loadProjectColumnSet()
	if err != nil {
		return err
	}

	assignments := []string{
		"name=?",
		"gitlab_url=?",
		"gitlab_token=?",
		"clone_base_path=?",
		"models=?",
	}
	values := []any{
		p.Name,
		p.GitLabURL,
		p.GitLabToken,
		p.CloneBasePath,
		p.Models,
	}

	if columns.SourceModelFolder {
		assignments = append(assignments, "source_model_folder=?")
		values = append(values, sourceModelFolder)
	}
	if columns.DefaultSubmitRepo {
		assignments = append(assignments, "default_submit_repo=?")
		values = append(values, strings.TrimSpace(p.DefaultSubmitRepo))
	}
	if columns.TaskTypes {
		assignments = append(assignments, "task_types=?")
		values = append(values, taskTypes)
	}
	if columns.TaskTypeQuotas {
		assignments = append(assignments, "task_type_quotas=?")
		values = append(values, quotas)
	}

	assignments = append(assignments, "updated_at=?")
	values = append(values, now, p.ID)

	stmt := fmt.Sprintf("UPDATE projects SET %s WHERE id=?", strings.Join(assignments, ", "))
	_, err = s.DB.Exec(stmt, values...)
	return err
}

// ConsumeProjectQuota decrements the quota for a given task type by 1.
// Returns an error if the quota is already 0 or the project is not found.
func (s *Store) ConsumeProjectQuota(projectID, taskType string) error {
	p, err := s.GetProject(projectID)
	if err != nil {
		return err
	}
	if p == nil {
		return fmt.Errorf("project not found: %s", projectID)
	}

	var quotas map[string]int
	if p.TaskTypeQuotas != "" && p.TaskTypeQuotas != "{}" {
		if err := json.Unmarshal([]byte(p.TaskTypeQuotas), &quotas); err != nil {
			return fmt.Errorf("invalid task_type_quotas JSON: %w", err)
		}
	} else {
		quotas = make(map[string]int)
	}

	current, ok := quotas[taskType]
	if !ok || current <= 0 {
		return fmt.Errorf("任务类型 %q 的配额已用尽", taskType)
	}
	quotas[taskType] = current - 1

	updated, err := json.Marshal(quotas)
	if err != nil {
		return err
	}

	now := time.Now().Unix()
	_, err = s.DB.Exec("UPDATE projects SET task_type_quotas=?, updated_at=? WHERE id=?", string(updated), now, projectID)
	return err
}

func adjustProjectQuotaForTaskTypeChange(quotas map[string]int, previousTaskType, nextTaskType string) error {
	if previousTaskType == nextTaskType {
		return nil
	}

	if current, ok := quotas[nextTaskType]; ok {
		if current <= 0 {
			return fmt.Errorf("任务类型 %q 的配额已用尽", nextTaskType)
		}
		quotas[nextTaskType] = current - 1
	}

	if current, ok := quotas[previousTaskType]; ok {
		quotas[previousTaskType] = current + 1
	}

	return nil
}

func (s *Store) DeleteProject(id string) error {
	_, err := s.DB.Exec("DELETE FROM projects WHERE id = ?", id)
	return err
}
