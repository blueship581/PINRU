package config

import (
	"strings"

	"github.com/blueship581/pinru/internal/github"
	"github.com/blueship581/pinru/internal/gitlab"
	"github.com/blueship581/pinru/internal/store"
)

// Service manages application configuration, projects, LLM providers, and
// GitHub accounts.
type ConfigService struct {
	store *store.Store
}

// NewService creates a new config service.
func New(store *store.Store) *ConfigService {
	return &ConfigService{store: store}
}

// GitLabSettings is the sanitized view of GitLab credentials returned to the frontend.
type GitLabSettings struct {
	URL      string `json:"url"`
	Username string `json:"username"`
	HasToken bool   `json:"hasToken"`
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

func (s *ConfigService) TestGitLabConnection(url, token string) (bool, error) {
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
	return gitlab.TestConnection(url, token)
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

	return &GitLabSettings{
		URL:      strings.TrimSpace(url),
		Username: strings.TrimSpace(username),
		HasToken: strings.TrimSpace(token) != "",
	}, nil
}

func (s *ConfigService) SaveGitLabSettings(url, username, token string) error {
	if err := s.store.SetConfig("gitlab_url", strings.TrimSpace(url)); err != nil {
		return err
	}
	if err := s.store.SetConfig("gitlab_username", strings.TrimSpace(username)); err != nil {
		return err
	}
	if strings.TrimSpace(token) != "" {
		if err := s.store.SetConfig("gitlab_token", strings.TrimSpace(token)); err != nil {
			return err
		}
	}
	return nil
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
		sanitized = append(sanitized, project)
	}

	return sanitized, nil
}

func (s *ConfigService) CreateProject(p store.Project) error {
	return s.store.CreateProject(p)
}

func (s *ConfigService) UpdateProject(p store.Project) error {
	if strings.TrimSpace(p.GitLabToken) == "" {
		existing, err := s.store.GetProject(p.ID)
		if err != nil {
			return err
		}
		if existing != nil {
			p.GitLabToken = existing.GitLabToken
		}
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

func isSensitiveConfigKey(key string) bool {
	return strings.EqualFold(strings.TrimSpace(key), "gitlab_token")
}
