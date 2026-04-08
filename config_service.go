package main

import (
	"github.com/blueship581/pinru/internal/github"
	"github.com/blueship581/pinru/internal/gitlab"
	"github.com/blueship581/pinru/internal/store"
)

type ConfigService struct {
	store *store.Store
}

func (s *ConfigService) GetConfig(key string) (string, error) {
	return s.store.GetConfig(key)
}

func (s *ConfigService) SetConfig(key, value string) error {
	return s.store.SetConfig(key, value)
}

func (s *ConfigService) TestGitLabConnection(url, token string) (bool, error) {
	return gitlab.TestConnection(url, token)
}

func (s *ConfigService) TestGitHubConnection(username, token string) (bool, error) {
	return github.TestConnection(username, token)
}

// Project CRUD
func (s *ConfigService) ListProjects() ([]store.Project, error) {
	return s.store.ListProjects()
}

func (s *ConfigService) CreateProject(p store.Project) error {
	return s.store.CreateProject(p)
}

func (s *ConfigService) UpdateProject(p store.Project) error {
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
	return s.store.ListLLMProviders()
}

func (s *ConfigService) CreateLLMProvider(p store.LLMProvider) error {
	return s.store.CreateLLMProvider(p)
}

func (s *ConfigService) UpdateLLMProvider(p store.LLMProvider) error {
	return s.store.UpdateLLMProvider(p)
}

func (s *ConfigService) DeleteLLMProvider(id string) error {
	return s.store.DeleteLLMProvider(id)
}

// GitHub Account CRUD
func (s *ConfigService) ListGitHubAccounts() ([]store.GitHubAccount, error) {
	return s.store.ListGitHubAccounts()
}

func (s *ConfigService) CreateGitHubAccount(a store.GitHubAccount) error {
	return s.store.CreateGitHubAccount(a)
}

func (s *ConfigService) UpdateGitHubAccount(a store.GitHubAccount) error {
	return s.store.UpdateGitHubAccount(a)
}

func (s *ConfigService) DeleteGitHubAccount(id string) error {
	return s.store.DeleteGitHubAccount(id)
}
