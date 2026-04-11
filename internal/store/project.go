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
	defaultProjectTotals     = "{}"
	defaultProjectOverview   = ""
)

type Project struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	GitLabURL         string `json:"gitlabUrl"`
	GitLabToken       string `json:"gitlabToken"`
	HasGitLabToken    bool   `json:"hasGitLabToken"`
	CloneBasePath     string `json:"cloneBasePath"`
	Models            string `json:"models"`
	SourceModelFolder string `json:"sourceModelFolder"`
	DefaultSubmitRepo string `json:"defaultSubmitRepo"`
	TaskTypes         string `json:"taskTypes"`
	TaskTypeQuotas    string `json:"taskTypeQuotas"`
	TaskTypeTotals    string `json:"taskTypeTotals"`
	OverviewMarkdown  string `json:"overviewMarkdown"`
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
	TaskTypeTotals    bool
	OverviewMarkdown  bool
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
	if columns.TaskTypeTotals, err = s.columnExists("projects", "task_type_totals"); err != nil {
		return columns, err
	}
	if columns.OverviewMarkdown, err = s.columnExists("projects", "overview_markdown"); err != nil {
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
		"SELECT id, name, gitlab_url, gitlab_token, clone_base_path, models, %s, %s, %s, %s, %s, %s, created_at, updated_at FROM projects",
		projectSelectExpr(columns.SourceModelFolder, "source_model_folder", "'"+defaultSourceModelFolder+"'"),
		projectSelectExpr(columns.DefaultSubmitRepo, "default_submit_repo", "''"),
		projectSelectExpr(columns.TaskTypes, "task_types", "'"+defaultProjectTaskTypes+"'"),
		projectSelectExpr(columns.TaskTypeQuotas, "task_type_quotas", "'"+defaultProjectQuotas+"'"),
		projectSelectExpr(columns.TaskTypeTotals, "task_type_totals", "'"+defaultProjectTotals+"'"),
		projectSelectExpr(columns.OverviewMarkdown, "overview_markdown", "'"+defaultProjectOverview+"'"),
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
		&p.TaskTypeTotals,
		&p.OverviewMarkdown,
		&p.CreatedAt,
		&p.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &p, nil
}

func normalizeProjectPayload(p Project) (string, string, string, string, string, error) {
	sourceModelFolder := strings.TrimSpace(p.SourceModelFolder)
	if sourceModelFolder == "" {
		sourceModelFolder = defaultSourceModelFolder
	}

	taskConfig, err := parseProjectTaskConfig(p.TaskTypes, p.TaskTypeQuotas, p.TaskTypeTotals)
	if err != nil {
		return "", "", "", "", "", err
	}

	taskTypes, quotas, totals, err := taskConfig.Serialize()
	if err != nil {
		return "", "", "", "", "", err
	}

	overviewMarkdown := strings.ReplaceAll(p.OverviewMarkdown, "\r\n", "\n")
	overviewMarkdown = strings.ReplaceAll(overviewMarkdown, "\r", "\n")

	return sourceModelFolder, taskTypes, quotas, totals, overviewMarkdown, nil
}

func parseTaskTypeCountMap(raw string) (map[string]int, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "{}" {
		return make(map[string]int), nil
	}

	var counts map[string]int
	if err := json.Unmarshal([]byte(trimmed), &counts); err != nil {
		return nil, fmt.Errorf("invalid task type count JSON: %w", err)
	}
	return cloneTaskTypeCountMap(counts), nil
}

func marshalTaskTypeCountMap(counts map[string]int) (string, error) {
	if counts == nil {
		counts = make(map[string]int)
	}

	payload, err := json.Marshal(counts)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

func (s *Store) countProjectUsedQuotaByTaskType(projectID string) (map[string]int, error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return make(map[string]int), nil
	}

	tasks, err := s.ListTasks(&projectID)
	if err != nil {
		return nil, err
	}

	counts := make(map[string]int)
	for _, task := range tasks {
		for _, session := range task.SessionList {
			if !session.ConsumeQuota {
				continue
			}

			taskType := strings.TrimSpace(session.TaskType)
			if taskType == "" {
				continue
			}

			counts[taskType]++
		}
	}

	return counts, nil
}

func (s *Store) backfillProjectTaskTypeTotals() error {
	columns, err := s.loadProjectColumnSet()
	if err != nil {
		return err
	}
	if !columns.TaskTypeTotals {
		return nil
	}

	projects, err := s.ListProjects()
	if err != nil {
		return err
	}

	now := time.Now().Unix()
	for _, project := range projects {
		if strings.TrimSpace(project.TaskTypeTotals) != "" && strings.TrimSpace(project.TaskTypeTotals) != "{}" {
			continue
		}
		if strings.TrimSpace(project.TaskTypeQuotas) == "" || strings.TrimSpace(project.TaskTypeQuotas) == "{}" {
			continue
		}

		remainingCounts, err := parseTaskTypeCountMap(project.TaskTypeQuotas)
		if err != nil {
			return fmt.Errorf("backfill project %s quotas: %w", project.ID, err)
		}
		usedCounts, err := s.countProjectUsedQuotaByTaskType(project.ID)
		if err != nil {
			return fmt.Errorf("backfill project %s usage: %w", project.ID, err)
		}

		totalCounts := make(map[string]int, len(remainingCounts)+len(usedCounts))
		for taskType, remaining := range remainingCounts {
			totalCounts[taskType] = remaining + usedCounts[taskType]
		}
		for taskType, used := range usedCounts {
			if _, exists := totalCounts[taskType]; !exists {
				totalCounts[taskType] = used
			}
		}

		totalJSON, err := marshalTaskTypeCountMap(totalCounts)
		if err != nil {
			return fmt.Errorf("backfill project %s totals: %w", project.ID, err)
		}

		if _, err := s.DB.Exec(
			"UPDATE projects SET task_type_totals=?, updated_at=? WHERE id=?",
			totalJSON,
			now,
			project.ID,
		); err != nil {
			return err
		}
	}

	return nil
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
	sourceModelFolder, taskTypes, quotas, totals, overviewMarkdown, err := normalizeProjectPayload(p)
	if err != nil {
		return err
	}

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
	if columns.TaskTypeTotals {
		columnNames = append(columnNames, "task_type_totals")
		values = append(values, totals)
	}
	if columns.OverviewMarkdown {
		columnNames = append(columnNames, "overview_markdown")
		values = append(values, overviewMarkdown)
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
	sourceModelFolder, taskTypes, quotas, totals, overviewMarkdown, err := normalizeProjectPayload(p)
	if err != nil {
		return err
	}

	columns, err := s.loadProjectColumnSet()
	if err != nil {
		return err
	}

	desiredTotals, err := parseTaskTypeCountMap(totals)
	if err != nil {
		return err
	}

	usedCounts, err := s.countProjectUsedQuotaByTaskType(p.ID)
	if err != nil {
		return err
	}

	recomputedQuotas := make(map[string]int, len(desiredTotals))
	for taskType, total := range desiredTotals {
		recomputedQuotas[taskType] = total - usedCounts[taskType]
	}

	if totals, err = marshalTaskTypeCountMap(desiredTotals); err != nil {
		return err
	}
	if quotas, err = marshalTaskTypeCountMap(recomputedQuotas); err != nil {
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
	if columns.TaskTypeTotals {
		assignments = append(assignments, "task_type_totals=?")
		values = append(values, totals)
	}
	if columns.OverviewMarkdown {
		assignments = append(assignments, "overview_markdown=?")
		values = append(values, overviewMarkdown)
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

	quotas, err := parseTaskTypeCountMap(p.TaskTypeQuotas)
	if err != nil {
		return err
	}

	current, ok := quotas[taskType]
	if !ok || current <= 0 {
		return fmt.Errorf("任务类型 %q 的配额已用尽", taskType)
	}
	quotas[taskType] = current - 1

	updated, err := marshalTaskTypeCountMap(quotas)
	if err != nil {
		return err
	}

	now := time.Now().Unix()
	_, err = s.DB.Exec("UPDATE projects SET task_type_quotas=?, updated_at=? WHERE id=?", updated, now, projectID)
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
