package config

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/blueship581/pinru/app/testutil"
	"github.com/blueship581/pinru/internal/store"
)

func TestCreateProjectValidatesQuestionBankIDsWithManagedProjectRef(t *testing.T) {
	var requestedPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestedPath = r.URL.EscapedPath()
		if requestedPath != "/api/v4/projects/prompt2repo%2Flabel-02362" {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":   98765,
			"name": "label-02362",
		})
	}))
	defer server.Close()

	testStore := testutil.OpenTestStore(t)
	service := New(testStore)

	err := service.CreateProject(store.Project{
		ID:                     "project-1",
		Name:                   "Demo",
		GitLabURL:              server.URL,
		GitLabToken:            "glpat-test",
		CloneBasePath:          t.TempDir(),
		Models:                 "ORIGIN",
		SourceModelFolder:      "ORIGIN",
		QuestionBankProjectIDs: "[2362]",
	})
	if err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}
	if requestedPath != "/api/v4/projects/prompt2repo%2Flabel-02362" {
		t.Fatalf("requestedPath = %q, want managed project ref path", requestedPath)
	}
}
