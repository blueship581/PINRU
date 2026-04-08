package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"
)

const (
	legacyProjectsConfigKey         = "projects"
	legacyGitHubAccountsConfigKey   = "github_accounts"
	legacyLLMProvidersConfigKey     = "llm_providers"
	legacyProjectsMigrationMarker   = "_internal_migration_projects_v1"
	legacyGitHubMigrationMarker     = "_internal_migration_github_accounts_v1"
	legacyLLMProvidersMigrationMark = "_internal_migration_llm_providers_v1"
)

type legacyProjectConfig struct {
	ID                string          `json:"id"`
	Name              string          `json:"name"`
	BasePath          string          `json:"basePath"`
	Models            json.RawMessage `json:"models"`
	DefaultSubmitRepo string          `json:"defaultSubmitRepo"`
	SourceModelFolder string          `json:"sourceModelFolder"`
}

type legacyGitHubAccountConfig struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Username    string `json:"username"`
	Token       string `json:"token"`
	DefaultRepo string `json:"defaultRepo"`
	IsDefault   bool   `json:"isDefault"`
}

type legacyLLMProviderConfig struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	ProviderType string  `json:"providerType"`
	Model        string  `json:"model"`
	BaseURL      *string `json:"baseUrl"`
	APIKey       string  `json:"apiKey"`
	IsDefault    bool    `json:"isDefault"`
}

func (s *Store) migrateLegacyConfigs() error {
	legacyGitHubRaw, err := s.GetConfig(legacyGitHubAccountsConfigKey)
	if err != nil {
		return err
	}

	legacyDefaultRepo := detectLegacyDefaultRepo(legacyGitHubRaw)

	if err := s.migrateLegacyProjects(legacyDefaultRepo); err != nil {
		return err
	}
	if err := s.migrateLegacyGitHubAccounts(legacyGitHubRaw); err != nil {
		return err
	}
	if err := s.migrateLegacyLLMProviders(); err != nil {
		return err
	}

	return nil
}

func (s *Store) migrateLegacyProjects(defaultSubmitRepoFallback string) error {
	done, err := s.hasMigrationMarker(legacyProjectsMigrationMarker)
	if err != nil || done {
		return err
	}

	hasRows, err := s.tableHasRows("projects")
	if err != nil {
		return err
	}
	if hasRows {
		return s.SetConfig(legacyProjectsMigrationMarker, "existing_rows")
	}

	raw, err := s.GetConfig(legacyProjectsConfigKey)
	if err != nil {
		return err
	}
	if strings.TrimSpace(raw) == "" {
		return s.SetConfig(legacyProjectsMigrationMarker, "no_data")
	}

	var legacyProjects []legacyProjectConfig
	if err := json.Unmarshal([]byte(raw), &legacyProjects); err != nil {
		log.Printf("skip legacy projects migration: %v", err)
		return nil
	}

	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := time.Now().Unix()
	for index, legacyProject := range legacyProjects {
		projectID := strings.TrimSpace(legacyProject.ID)
		if projectID == "" {
			projectID = fmt.Sprintf("legacy-project-%d", index+1)
		}

		projectName := strings.TrimSpace(legacyProject.Name)
		if projectName == "" {
			projectName = projectID
		}

		models := normalizeLegacyModels(legacyProject.Models)
		sourceModelFolder := normalizeLegacySourceModelFolder(legacyProject.SourceModelFolder, models)
		defaultSubmitRepo := strings.TrimSpace(legacyProject.DefaultSubmitRepo)
		if defaultSubmitRepo == "" {
			defaultSubmitRepo = defaultSubmitRepoFallback
		}

		if _, err := tx.Exec(
			`INSERT INTO projects (
				id, name, gitlab_url, gitlab_token, clone_base_path, models,
				source_model_folder, default_submit_repo, task_types, task_type_quotas, created_at, updated_at
			) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
			ON CONFLICT(id) DO UPDATE SET
				name = excluded.name,
				gitlab_url = excluded.gitlab_url,
				gitlab_token = excluded.gitlab_token,
				clone_base_path = excluded.clone_base_path,
				models = excluded.models,
				source_model_folder = excluded.source_model_folder,
				default_submit_repo = excluded.default_submit_repo,
				task_types = excluded.task_types,
				task_type_quotas = excluded.task_type_quotas,
				updated_at = excluded.updated_at`,
			projectID,
			projectName,
			"",
			"",
			strings.TrimSpace(legacyProject.BasePath),
			serializeLegacyModels(models),
			sourceModelFolder,
			defaultSubmitRepo,
			"[]",
			"{}",
			now,
			now,
		); err != nil {
			return fmt.Errorf("migrate legacy project %s: %w", projectID, err)
		}
	}

	if err := finalizeLegacyMigration(tx, legacyProjectsMigrationMarker, legacyProjectsConfigKey); err != nil {
		return err
	}

	return tx.Commit()
}

func (s *Store) migrateLegacyGitHubAccounts(raw string) error {
	done, err := s.hasMigrationMarker(legacyGitHubMigrationMarker)
	if err != nil || done {
		return err
	}

	hasRows, err := s.tableHasRows("github_accounts")
	if err != nil {
		return err
	}
	if hasRows {
		return s.SetConfig(legacyGitHubMigrationMarker, "existing_rows")
	}

	if strings.TrimSpace(raw) == "" {
		return s.SetConfig(legacyGitHubMigrationMarker, "no_data")
	}

	var legacyAccounts []legacyGitHubAccountConfig
	if err := json.Unmarshal([]byte(raw), &legacyAccounts); err != nil {
		log.Printf("skip legacy github_accounts migration: %v", err)
		return nil
	}
	legacyAccounts = normalizeLegacyGitHubAccounts(legacyAccounts)

	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := time.Now().Unix()
	for index, legacyAccount := range legacyAccounts {
		accountID := strings.TrimSpace(legacyAccount.ID)
		if accountID == "" {
			accountID = fmt.Sprintf("legacy-github-%d", index+1)
		}

		accountName := strings.TrimSpace(legacyAccount.Name)
		if accountName == "" {
			accountName = strings.TrimSpace(legacyAccount.Username)
		}

		isDefault := 0
		if legacyAccount.IsDefault {
			isDefault = 1
		}

		if _, err := tx.Exec(
			`INSERT INTO github_accounts (id, name, username, token, is_default, created_at, updated_at)
			VALUES (?,?,?,?,?,?,?)
			ON CONFLICT(id) DO UPDATE SET
				name = excluded.name,
				username = excluded.username,
				token = excluded.token,
				is_default = excluded.is_default,
				updated_at = excluded.updated_at`,
			accountID,
			accountName,
			strings.TrimSpace(legacyAccount.Username),
			strings.TrimSpace(legacyAccount.Token),
			isDefault,
			now,
			now,
		); err != nil {
			return fmt.Errorf("migrate legacy github account %s: %w", accountID, err)
		}
	}

	if err := finalizeLegacyMigration(tx, legacyGitHubMigrationMarker, legacyGitHubAccountsConfigKey); err != nil {
		return err
	}

	return tx.Commit()
}

func (s *Store) migrateLegacyLLMProviders() error {
	done, err := s.hasMigrationMarker(legacyLLMProvidersMigrationMark)
	if err != nil || done {
		return err
	}

	hasRows, err := s.tableHasRows("llm_providers")
	if err != nil {
		return err
	}
	if hasRows {
		return s.SetConfig(legacyLLMProvidersMigrationMark, "existing_rows")
	}

	raw, err := s.GetConfig(legacyLLMProvidersConfigKey)
	if err != nil {
		return err
	}
	if strings.TrimSpace(raw) == "" {
		return s.SetConfig(legacyLLMProvidersMigrationMark, "no_data")
	}

	var legacyProviders []legacyLLMProviderConfig
	if err := json.Unmarshal([]byte(raw), &legacyProviders); err != nil {
		log.Printf("skip legacy llm_providers migration: %v", err)
		return nil
	}
	legacyProviders = normalizeLegacyLLMProviders(legacyProviders)

	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := time.Now().Unix()
	for index, legacyProvider := range legacyProviders {
		providerID := strings.TrimSpace(legacyProvider.ID)
		if providerID == "" {
			providerID = fmt.Sprintf("legacy-llm-%d", index+1)
		}

		providerName := strings.TrimSpace(legacyProvider.Name)
		if providerName == "" {
			providerName = providerID
		}

		baseURL := strings.TrimSpace(sqlNullString(legacyProvider.BaseURL))
		var normalizedBaseURL *string
		if baseURL != "" {
			normalizedBaseURL = &baseURL
		}

		isDefault := 0
		if legacyProvider.IsDefault {
			isDefault = 1
		}

		if _, err := tx.Exec(
			`INSERT INTO llm_providers (
				id, name, provider_type, model, base_url, api_key, is_default, created_at, updated_at
			) VALUES (?,?,?,?,?,?,?,?,?)
			ON CONFLICT(id) DO UPDATE SET
				name = excluded.name,
				provider_type = excluded.provider_type,
				model = excluded.model,
				base_url = excluded.base_url,
				api_key = excluded.api_key,
				is_default = excluded.is_default,
				updated_at = excluded.updated_at`,
			providerID,
			providerName,
			normalizeLegacyProviderType(legacyProvider.ProviderType),
			strings.TrimSpace(legacyProvider.Model),
			normalizedBaseURL,
			strings.TrimSpace(legacyProvider.APIKey),
			isDefault,
			now,
			now,
		); err != nil {
			return fmt.Errorf("migrate legacy llm provider %s: %w", providerID, err)
		}
	}

	if err := finalizeLegacyMigration(tx, legacyLLMProvidersMigrationMark, legacyLLMProvidersConfigKey); err != nil {
		return err
	}

	return tx.Commit()
}

func finalizeLegacyMigration(tx *sql.Tx, markerKey, legacyConfigKey string) error {
	if _, err := tx.Exec(
		"INSERT INTO configs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		markerKey,
		"done",
	); err != nil {
		return err
	}

	if _, err := tx.Exec("DELETE FROM configs WHERE key = ?", legacyConfigKey); err != nil {
		return err
	}

	return nil
}

func (s *Store) hasMigrationMarker(markerKey string) (bool, error) {
	value, err := s.GetConfig(markerKey)
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(value) != "", nil
}

func (s *Store) tableHasRows(table string) (bool, error) {
	var exists int
	query := fmt.Sprintf("SELECT EXISTS(SELECT 1 FROM %s LIMIT 1)", table)
	if err := s.DB.QueryRow(query).Scan(&exists); err != nil {
		return false, err
	}
	return exists != 0, nil
}

func detectLegacyDefaultRepo(raw string) string {
	var accounts []legacyGitHubAccountConfig
	if err := json.Unmarshal([]byte(raw), &accounts); err != nil {
		return ""
	}

	for _, account := range accounts {
		if account.IsDefault && strings.TrimSpace(account.DefaultRepo) != "" {
			return strings.TrimSpace(account.DefaultRepo)
		}
	}
	for _, account := range accounts {
		if strings.TrimSpace(account.DefaultRepo) != "" {
			return strings.TrimSpace(account.DefaultRepo)
		}
	}

	return ""
}

func normalizeLegacyGitHubAccounts(accounts []legacyGitHubAccountConfig) []legacyGitHubAccountConfig {
	hasDefault := false
	for _, account := range accounts {
		if account.IsDefault {
			hasDefault = true
			break
		}
	}
	if !hasDefault && len(accounts) > 0 {
		accounts[0].IsDefault = true
	}
	return accounts
}

func normalizeLegacyLLMProviders(providers []legacyLLMProviderConfig) []legacyLLMProviderConfig {
	hasDefault := false
	for _, provider := range providers {
		if provider.IsDefault {
			hasDefault = true
			break
		}
	}
	if !hasDefault && len(providers) > 0 {
		providers[0].IsDefault = true
	}
	return providers
}

func normalizeLegacyModels(raw json.RawMessage) []string {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return []string{"ORIGIN"}
	}

	models := make([]string, 0)
	switch trimmed[0] {
	case '[':
		var parsed []any
		if err := json.Unmarshal(raw, &parsed); err == nil {
			for _, item := range parsed {
				models = append(models, fmt.Sprint(item))
			}
		}
	case '"':
		var single string
		if err := json.Unmarshal(raw, &single); err == nil {
			models = splitLegacyList(single)
		}
	default:
		models = splitLegacyList(trimmed)
	}

	return normalizeLegacyModelNames(models)
}

func normalizeLegacyModelNames(models []string) []string {
	seen := make(map[string]struct{})
	normalized := make([]string, 0, len(models)+1)

	appendModel := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}

		identity := strings.ToUpper(value)
		if identity == "ORIGIN" {
			value = "ORIGIN"
			identity = "ORIGIN"
		}

		if _, ok := seen[identity]; ok {
			return
		}
		seen[identity] = struct{}{}
		normalized = append(normalized, value)
	}

	appendModel("ORIGIN")
	for _, model := range models {
		appendModel(model)
	}

	return normalized
}

func serializeLegacyModels(models []string) string {
	return strings.Join(normalizeLegacyModelNames(models), ",")
}

func normalizeLegacySourceModelFolder(sourceModelFolder string, models []string) string {
	candidate := strings.TrimSpace(sourceModelFolder)
	if candidate == "" {
		return "ORIGIN"
	}

	for _, model := range models {
		if strings.EqualFold(model, candidate) {
			return model
		}
	}

	return "ORIGIN"
}

func normalizeLegacyProviderType(providerType string) string {
	switch strings.TrimSpace(providerType) {
	case "anthropic":
		return "anthropic"
	default:
		return "openai_compatible"
	}
}

func splitLegacyList(value string) []string {
	return strings.FieldsFunc(value, func(r rune) bool {
		switch r {
		case ',', '\n', '\r', '\t':
			return true
		default:
			return false
		}
	})
}

func sqlNullString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
