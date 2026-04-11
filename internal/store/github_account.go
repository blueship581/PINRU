package store

import (
	"database/sql"
	"time"
)

type GitHubAccount struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Username  string `json:"username"`
	Token     string `json:"token"`
	HasToken  bool   `json:"hasToken"`
	IsDefault bool   `json:"isDefault"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

func (s *Store) ListGitHubAccounts() ([]GitHubAccount, error) {
	rows, err := s.DB.Query("SELECT id, name, username, token, is_default, created_at, updated_at FROM github_accounts ORDER BY created_at DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	accounts := make([]GitHubAccount, 0)
	for rows.Next() {
		var a GitHubAccount
		var isDefault int
		if err := rows.Scan(&a.ID, &a.Name, &a.Username, &a.Token, &isDefault, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		a.IsDefault = isDefault != 0
		accounts = append(accounts, a)
	}
	return accounts, rows.Err()
}

func (s *Store) CreateGitHubAccount(a GitHubAccount) error {
	now := time.Now().Unix()
	isDefault := 0
	if a.IsDefault {
		isDefault = 1
	}
	_, err := s.DB.Exec(
		"INSERT INTO github_accounts (id, name, username, token, is_default, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
		a.ID, a.Name, a.Username, a.Token, isDefault, now, now)
	return err
}

func (s *Store) GetGitHubAccount(id string) (*GitHubAccount, error) {
	var account GitHubAccount
	var isDefault int
	err := s.DB.QueryRow(
		"SELECT id, name, username, token, is_default, created_at, updated_at FROM github_accounts WHERE id = ?",
		id,
	).Scan(&account.ID, &account.Name, &account.Username, &account.Token, &isDefault, &account.CreatedAt, &account.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	account.IsDefault = isDefault != 0
	return &account, nil
}

func (s *Store) UpdateGitHubAccount(a GitHubAccount) error {
	now := time.Now().Unix()
	isDefault := 0
	if a.IsDefault {
		isDefault = 1
	}
	_, err := s.DB.Exec(
		"UPDATE github_accounts SET name=?, username=?, token=?, is_default=?, updated_at=? WHERE id=?",
		a.Name, a.Username, a.Token, isDefault, now, a.ID)
	return err
}

func (s *Store) DeleteGitHubAccount(id string) error {
	_, err := s.DB.Exec("DELETE FROM github_accounts WHERE id = ?", id)
	return err
}
