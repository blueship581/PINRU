package store

import "database/sql"

func (s *Store) GetConfig(key string) (string, error) {
	var value string
	err := s.DB.QueryRow("SELECT value FROM configs WHERE key = ?", key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return value, err
}

func (s *Store) SetConfig(key, value string) error {
	_, err := s.DB.Exec(
		"INSERT INTO configs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		key, value)
	return err
}
