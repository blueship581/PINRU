package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/blueship581/pinru/internal/errs"
	"github.com/blueship581/pinru/internal/github"
	"github.com/blueship581/pinru/internal/gitlab"
	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/internal/trae"
	"github.com/blueship581/pinru/internal/util"
)

// TraeSettings holds Trae IDE path configuration returned to the frontend.
type TraeSettings struct {
	WorkspaceStoragePath        string `json:"workspaceStoragePath"`
	LogsPath                    string `json:"logsPath"`
	DefaultWorkspaceStoragePath string `json:"defaultWorkspaceStoragePath"`
	DefaultLogsPath             string `json:"defaultLogsPath"`
}

// Service manages application configuration, projects, LLM providers, and
// GitHub accounts.
type ConfigService struct {
	store         *store.Store
	traeProvider  *trae.Provider
}

// NewService creates a new config service.
func New(store *store.Store) *ConfigService {
	return &ConfigService{store: store}
}

// SetTraeProvider 注入 trae 数据库 Provider，用于在保存配置后触发 Reload。
// main.go 在 ConfigService、TraeProvider 都构造完后调用一次。
func (s *ConfigService) SetTraeProvider(provider *trae.Provider) {
	s.traeProvider = provider
}

// GitLabSettings is the sanitized view of GitLab credentials returned to the frontend.
type GitLabSettings struct {
	URL           string `json:"url"`
	Username      string `json:"username"`
	HasToken      bool   `json:"hasToken"`
	SkipTLSVerify bool   `json:"skipTlsVerify"`
}

func (s *ConfigService) GetConfig(key string) (string, error) {
	if isSensitiveConfigKey(key) {
		return "", nil
	}
	return s.store.GetConfig(key)
}

func (s *ConfigService) SetConfig(key, value string) error {
	return s.store.SetConfig(key, value)
}

func (s *ConfigService) TestGitLabConnection(url, token string, skipTLSVerify bool) (bool, error) {
	if strings.TrimSpace(url) == "" {
		storedURL, err := s.store.GetConfig("gitlab_url")
		if err != nil {
			return false, err
		}
		url = storedURL
	}
	if strings.TrimSpace(token) == "" {
		storedToken, err := s.store.GetConfig("gitlab_token")
		if err != nil {
			return false, err
		}
		token = storedToken
	}
	return gitlab.TestConnection(url, token, skipTLSVerify)
}

func (s *ConfigService) TestGitHubConnection(username, token string) (bool, error) {
	return github.TestConnection(username, token)
}

func (s *ConfigService) TestGitHubAccountConnection(id, username, token string) (bool, error) {
	if strings.TrimSpace(token) == "" && strings.TrimSpace(id) != "" {
		account, err := s.store.GetGitHubAccount(id)
		if err != nil {
			return false, err
		}
		if account == nil {
			return false, nil
		}
		token = account.Token
		if strings.TrimSpace(username) == "" {
			username = account.Username
		}
	}
	return github.TestConnection(username, token)
}

func (s *ConfigService) GetGitLabSettings() (*GitLabSettings, error) {
	url, err := s.store.GetConfig("gitlab_url")
	if err != nil {
		return nil, err
	}
	username, err := s.store.GetConfig("gitlab_username")
	if err != nil {
		return nil, err
	}
	token, err := s.store.GetConfig("gitlab_token")
	if err != nil {
		return nil, err
	}
	skipTLSVerify, err := s.getGitLabSkipTLSVerify()
	if err != nil {
		return nil, err
	}

	return &GitLabSettings{
		URL:           strings.TrimSpace(url),
		Username:      strings.TrimSpace(username),
		HasToken:      strings.TrimSpace(token) != "",
		SkipTLSVerify: skipTLSVerify,
	}, nil
}

func (s *ConfigService) SaveGitLabSettings(url, username, token string, skipTLSVerify bool) error {
	if err := s.store.SetConfig("gitlab_url", strings.TrimSpace(url)); err != nil {
		return err
	}
	if err := s.store.SetConfig("gitlab_username", strings.TrimSpace(username)); err != nil {
		return err
	}
	if err := s.store.SetConfig("gitlab_skip_tls_verify", strconv.FormatBool(skipTLSVerify)); err != nil {
		return err
	}
	if strings.TrimSpace(token) != "" {
		if err := s.store.SetConfig("gitlab_token", strings.TrimSpace(token)); err != nil {
			return err
		}
	}
	return nil
}

func (s *ConfigService) getGitLabSkipTLSVerify() (bool, error) {
	value, err := s.store.GetConfig("gitlab_skip_tls_verify")
	if err != nil {
		return false, err
	}
	parsed, err := strconv.ParseBool(strings.TrimSpace(value))
	if err != nil {
		return false, nil
	}
	return parsed, nil
}

// Project CRUD

func (s *ConfigService) ListProjects() ([]store.Project, error) {
	projects, err := s.store.ListProjects()
	if err != nil {
		return nil, err
	}

	sanitized := make([]store.Project, 0, len(projects))
	for _, project := range projects {
		project.HasGitLabToken = strings.TrimSpace(project.GitLabToken) != ""
		project.GitLabToken = ""
		project.CloneBasePath = util.NormalizePath(project.CloneBasePath)
		sanitized = append(sanitized, project)
	}

	return sanitized, nil
}

func (s *ConfigService) CreateProject(p store.Project) error {
	p.CloneBasePath = util.NormalizePath(p.CloneBasePath)
	if err := s.validateQuestionBankProjectIDs(p); err != nil {
		return err
	}
	return s.store.CreateProject(p)
}

func (s *ConfigService) UpdateProject(p store.Project) error {
	p.CloneBasePath = util.NormalizePath(p.CloneBasePath)
	if strings.TrimSpace(p.GitLabToken) == "" {
		existing, err := s.store.GetProject(p.ID)
		if err != nil {
			return err
		}
		if existing != nil {
			p.GitLabToken = existing.GitLabToken
		}
	}
	if err := s.validateQuestionBankProjectIDs(p); err != nil {
		return err
	}
	return s.store.UpdateProject(p)
}

func (s *ConfigService) DeleteProject(id string) error {
	return s.store.DeleteProject(id)
}

// ConsumeProjectQuota decrements the quota for taskType by 1.
func (s *ConfigService) ConsumeProjectQuota(projectID, taskType string) error {
	return s.store.ConsumeProjectQuota(projectID, taskType)
}

// LLM Provider CRUD

func (s *ConfigService) ListLLMProviders() ([]store.LLMProvider, error) {
	providers, err := s.store.ListLLMProviders()
	if err != nil {
		return nil, err
	}

	sanitized := make([]store.LLMProvider, 0, len(providers))
	for _, provider := range providers {
		provider.HasAPIKey = strings.TrimSpace(provider.APIKey) != ""
		provider.APIKey = ""
		sanitized = append(sanitized, provider)
	}

	return sanitized, nil
}

func (s *ConfigService) CreateLLMProvider(p store.LLMProvider) error {
	return s.store.CreateLLMProvider(p)
}

func (s *ConfigService) UpdateLLMProvider(p store.LLMProvider) error {
	if strings.TrimSpace(p.APIKey) == "" {
		existing, err := s.store.GetLLMProvider(p.ID)
		if err != nil {
			return err
		}
		if existing != nil {
			p.APIKey = existing.APIKey
		}
	}
	return s.store.UpdateLLMProvider(p)
}

func (s *ConfigService) DeleteLLMProvider(id string) error {
	return s.store.DeleteLLMProvider(id)
}

// GitHub Account CRUD

func (s *ConfigService) ListGitHubAccounts() ([]store.GitHubAccount, error) {
	accounts, err := s.store.ListGitHubAccounts()
	if err != nil {
		return nil, err
	}

	sanitized := make([]store.GitHubAccount, 0, len(accounts))
	for _, account := range accounts {
		account.HasToken = strings.TrimSpace(account.Token) != ""
		account.Token = ""
		sanitized = append(sanitized, account)
	}

	return sanitized, nil
}

func (s *ConfigService) CreateGitHubAccount(a store.GitHubAccount) error {
	return s.store.CreateGitHubAccount(a)
}

func (s *ConfigService) UpdateGitHubAccount(a store.GitHubAccount) error {
	if strings.TrimSpace(a.Token) == "" {
		existing, err := s.store.GetGitHubAccount(a.ID)
		if err != nil {
			return err
		}
		if existing != nil {
			a.Token = existing.Token
		}
	}
	return s.store.UpdateGitHubAccount(a)
}

func (s *ConfigService) DeleteGitHubAccount(id string) error {
	return s.store.DeleteGitHubAccount(id)
}

func parseQuestionBankProjectIDs(raw string) ([]int64, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "[]" {
		return []int64{}, nil
	}

	var numericIDs []int64
	if err := json.Unmarshal([]byte(trimmed), &numericIDs); err == nil {
		seen := make(map[int64]struct{}, len(numericIDs))
		ids := make([]int64, 0, len(numericIDs))
		for _, id := range numericIDs {
			if id <= 0 {
				return nil, fmt.Errorf(errs.FmtQuestionBankProjectIDInvalid, strconv.FormatInt(id, 10))
			}
			if _, exists := seen[id]; exists {
				continue
			}
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
		return ids, nil
	}

	var stringIDs []string
	if err := json.Unmarshal([]byte(trimmed), &stringIDs); err == nil {
		seen := make(map[int64]struct{}, len(stringIDs))
		ids := make([]int64, 0, len(stringIDs))
		for _, rawID := range stringIDs {
			value := strings.TrimSpace(rawID)
			id, parseErr := strconv.ParseInt(value, 10, 64)
			if parseErr != nil || id <= 0 {
				return nil, fmt.Errorf(errs.FmtQuestionBankProjectIDInvalid, value)
			}
			if _, exists := seen[id]; exists {
				continue
			}
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
		return ids, nil
	}

	return nil, errors.New(errs.MsgQuestionBankProjectIDsInvalid)
}

func (s *ConfigService) validateQuestionBankProjectIDs(p store.Project) error {
	questionIDs, err := parseQuestionBankProjectIDs(p.QuestionBankProjectIDs)
	if err != nil || len(questionIDs) == 0 {
		return err
	}

	url := strings.TrimSpace(p.GitLabURL)
	if url == "" {
		configuredURL, configErr := s.store.GetConfig("gitlab_url")
		if configErr != nil {
			return configErr
		}
		url = strings.TrimSpace(configuredURL)
	}

	token := strings.TrimSpace(p.GitLabToken)
	if token == "" {
		configuredToken, configErr := s.store.GetConfig("gitlab_token")
		if configErr != nil {
			return configErr
		}
		token = strings.TrimSpace(configuredToken)
	}

	if url == "" || token == "" {
		return errors.New(errs.MsgGitLabSettingsMissing)
	}
	skipTLSVerify, err := s.getGitLabSkipTLSVerify()
	if err != nil {
		return err
	}

	for _, questionID := range questionIDs {
		projectRef := util.BuildQuestionBankGitLabProjectRef(questionID)
		if _, err := gitlab.FetchProject(projectRef, url, token, skipTLSVerify); err != nil {
			return fmt.Errorf(errs.FmtQuestionBankProjectIDNotFound, strconv.FormatInt(questionID, 10))
		}
	}
	return nil
}

// GetTraeSettings returns the stored Trae IDE path overrides and the
// platform-appropriate defaults so the frontend can pre-fill fields.
func (s *ConfigService) GetTraeSettings() (*TraeSettings, error) {
	wsPath, err := s.store.GetConfig("trae_workspace_storage_path")
	if err != nil {
		wsPath = ""
	}
	logsPath, err := s.store.GetConfig("trae_logs_path")
	if err != nil {
		logsPath = ""
	}
	return &TraeSettings{
		WorkspaceStoragePath:        strings.TrimSpace(wsPath),
		LogsPath:                    strings.TrimSpace(logsPath),
		DefaultWorkspaceStoragePath: util.DefaultTraeWorkspaceStoragePath(),
		DefaultLogsPath:             util.DefaultTraeLogsPath(),
	}, nil
}

// SaveTraeSettings persists the Trae IDE path overrides.
// An empty string means "use platform default" and clears any stored override.
func (s *ConfigService) SaveTraeSettings(workspaceStoragePath, logsPath string) error {
	if err := s.store.SetConfig("trae_workspace_storage_path", strings.TrimSpace(workspaceStoragePath)); err != nil {
		return err
	}
	return s.store.SetConfig("trae_logs_path", strings.TrimSpace(logsPath))
}

func isSensitiveConfigKey(key string) bool {
	normalized := strings.ToLower(strings.TrimSpace(key))
	return normalized == "gitlab_token" || normalized == trae.ConfigKeyPassword
}

// TraeDBSettings 是返回给前端的 trae 数据库配置（密码已隐藏）。
type TraeDBSettings struct {
	Host        string   `json:"host"`
	Port        int      `json:"port"`
	User        string   `json:"user"`
	DBName      string   `json:"dbName"`
	HasPassword bool     `json:"hasPassword"`
	UserIDs     []string `json:"userIds"`
}

// GetTraeDBSettings 返回 store 中保存的 trae 数据库配置（敏感字段已脱敏）。
func (s *ConfigService) GetTraeDBSettings() (*TraeDBSettings, error) {
	host, err := s.store.GetConfig(trae.ConfigKeyHost)
	if err != nil {
		return nil, err
	}
	portRaw, err := s.store.GetConfig(trae.ConfigKeyPort)
	if err != nil {
		return nil, err
	}
	user, err := s.store.GetConfig(trae.ConfigKeyUser)
	if err != nil {
		return nil, err
	}
	password, err := s.store.GetConfig(trae.ConfigKeyPassword)
	if err != nil {
		return nil, err
	}
	dbName, err := s.store.GetConfig(trae.ConfigKeyDBName)
	if err != nil {
		return nil, err
	}
	userIDsRaw, err := s.store.GetConfig(trae.ConfigKeyUserIDs)
	if err != nil {
		return nil, err
	}
	port := 0
	if v := strings.TrimSpace(portRaw); v != "" {
		if parsed, perr := strconv.Atoi(v); perr == nil {
			port = parsed
		}
	}
	return &TraeDBSettings{
		Host:        strings.TrimSpace(host),
		Port:        port,
		User:        strings.TrimSpace(user),
		DBName:      strings.TrimSpace(dbName),
		HasPassword: strings.TrimSpace(password) != "",
		UserIDs:     trae.ParseUserIDs(userIDsRaw),
	}, nil
}

// SaveTraeDBSettings 持久化 trae 数据库连接参数。当 password 留空时表示
// "不修改",沿用 store 中已有值;非空时覆盖。保存后会触发 trae provider 重载。
func (s *ConfigService) SaveTraeDBSettings(host string, port int, user, password, dbName string, userIDs []string) error {
	if err := s.store.SetConfig(trae.ConfigKeyHost, strings.TrimSpace(host)); err != nil {
		return err
	}
	portValue := ""
	if port > 0 {
		portValue = strconv.Itoa(port)
	}
	if err := s.store.SetConfig(trae.ConfigKeyPort, portValue); err != nil {
		return err
	}
	if err := s.store.SetConfig(trae.ConfigKeyUser, strings.TrimSpace(user)); err != nil {
		return err
	}
	if err := s.store.SetConfig(trae.ConfigKeyDBName, strings.TrimSpace(dbName)); err != nil {
		return err
	}
	if strings.TrimSpace(password) != "" {
		if err := s.store.SetConfig(trae.ConfigKeyPassword, password); err != nil {
			return err
		}
	}
	userIDsJSON, err := trae.MarshalUserIDs(userIDs)
	if err != nil {
		return err
	}
	if err := s.store.SetConfig(trae.ConfigKeyUserIDs, userIDsJSON); err != nil {
		return err
	}
	if s.traeProvider != nil {
		s.traeProvider.Reload()
	}
	return nil
}

// TestTraeDBConnection 用前端传入的连接参数尝试 Open + Close。当 password 为空时
// 沿用 store 中已保存的密码,便于"只测当前已存配置"的场景。
func (s *ConfigService) TestTraeDBConnection(host string, port int, user, password, dbName string) (bool, error) {
	if strings.TrimSpace(password) == "" {
		stored, err := s.store.GetConfig(trae.ConfigKeyPassword)
		if err != nil {
			return false, err
		}
		password = stored
	}
	if port <= 0 {
		port = 3306
	}
	cfg := trae.Config{
		Host:     strings.TrimSpace(host),
		Port:     port,
		User:     strings.TrimSpace(user),
		Password: password,
		DBName:   strings.TrimSpace(dbName),
	}
	if cfg.Host == "" || cfg.User == "" || cfg.DBName == "" {
		return false, fmt.Errorf("host/user/db 不能为空")
	}
	if err := trae.TestConnection(cfg); err != nil {
		return false, err
	}
	return true, nil
}
