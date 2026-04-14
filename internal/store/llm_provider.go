package store

import (
	"database/sql"
	"time"
)

type LLMProvider struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	ProviderType string  `json:"providerType"`
	Model        string  `json:"model"`
	PolishModel  string  `json:"polishModel"`
	BaseURL      *string `json:"baseUrl"`
	APIKey       string  `json:"apiKey"`
	HasAPIKey    bool    `json:"hasApiKey"`
	IsDefault    bool    `json:"isDefault"`
	CreatedAt    int64   `json:"createdAt"`
	UpdatedAt    int64   `json:"updatedAt"`
}

func (s *Store) ListLLMProviders() ([]LLMProvider, error) {
	rows, err := s.DB.Query("SELECT id, name, provider_type, model, polish_model, base_url, api_key, is_default, created_at, updated_at FROM llm_providers ORDER BY created_at DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	providers := make([]LLMProvider, 0)
	for rows.Next() {
		var p LLMProvider
		var isDefault int
		if err := rows.Scan(&p.ID, &p.Name, &p.ProviderType, &p.Model, &p.PolishModel, &p.BaseURL, &p.APIKey, &isDefault, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		p.IsDefault = isDefault != 0
		providers = append(providers, p)
	}
	return providers, rows.Err()
}

func (s *Store) GetLLMProvider(id string) (*LLMProvider, error) {
	var p LLMProvider
	var isDefault int
	err := s.DB.QueryRow("SELECT id, name, provider_type, model, polish_model, base_url, api_key, is_default, created_at, updated_at FROM llm_providers WHERE id = ?", id).
		Scan(&p.ID, &p.Name, &p.ProviderType, &p.Model, &p.PolishModel, &p.BaseURL, &p.APIKey, &isDefault, &p.CreatedAt, &p.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	p.IsDefault = isDefault != 0
	return &p, nil
}

func (s *Store) CreateLLMProvider(p LLMProvider) error {
	now := time.Now().Unix()
	isDefault := 0
	if p.IsDefault {
		isDefault = 1
	}
	_, err := s.DB.Exec(
		"INSERT INTO llm_providers (id, name, provider_type, model, polish_model, base_url, api_key, is_default, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
		p.ID, p.Name, p.ProviderType, p.Model, p.PolishModel, p.BaseURL, p.APIKey, isDefault, now, now)
	return err
}

func (s *Store) UpdateLLMProvider(p LLMProvider) error {
	now := time.Now().Unix()
	isDefault := 0
	if p.IsDefault {
		isDefault = 1
	}
	_, err := s.DB.Exec(
		"UPDATE llm_providers SET name=?, provider_type=?, model=?, polish_model=?, base_url=?, api_key=?, is_default=?, updated_at=? WHERE id=?",
		p.Name, p.ProviderType, p.Model, p.PolishModel, p.BaseURL, p.APIKey, isDefault, now, p.ID)
	return err
}

func (s *Store) DeleteLLMProvider(id string) error {
	_, err := s.DB.Exec("DELETE FROM llm_providers WHERE id = ?", id)
	return err
}
