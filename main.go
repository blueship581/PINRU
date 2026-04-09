package main

import (
	"embed"
	"log"
	"os"
	"path/filepath"

	"github.com/blueship581/pinru/internal/store"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed migrations/001_init.sql
var migration001 string

//go:embed migrations/002_model_runs_extend.sql
var migration002 string

//go:embed migrations/003_submit_results.sql
var migration003 string

//go:embed migrations/004_task_type.sql
var migration004 string

//go:embed migrations/005_project_task_quotas.sql
var migration005 string

//go:embed migrations/006_project_submit_defaults.sql
var migration006 string

//go:embed migrations/007_project_task_types.sql
var migration007 string

//go:embed migrations/008_task_session_list.sql
var migration008 string

//go:embed migrations/009_task_prompt_generation_status.sql
var migration009 string

//go:embed migrations/010_project_task_type_totals.sql
var migration010 string

func main() {
	home, _ := os.UserHomeDir()
	dbPath := filepath.Join(home, ".pinru", "pinru.db")

	db, err := store.Open(
		dbPath,
		migration001,
		migration002,
		migration003,
		migration004,
		migration005,
		migration006,
		migration007,
		migration008,
		migration009,
		migration010,
	)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer db.Close()

	configSvc := &ConfigService{store: db}
	taskSvc := &TaskService{store: db}
	gitSvc := &GitService{store: db}
	promptSvc := &PromptService{store: db}
	submitSvc := &SubmitService{store: db}
	cliSvc := NewCliService()
	chatSvc := &ChatService{store: db, cliSvc: cliSvc}

	// Pre-install bundled skills to ~/.claude/skills/ (non-destructive).
	cliSvc.InstallBuiltinSkills()

	app := application.New(application.Options{
		Name:        "PinRu",
		Description: "AI Model Code Review Workstation",
		Services: []application.Service{
			application.NewService(configSvc),
			application.NewService(taskSvc),
			application.NewService(gitSvc),
			application.NewService(promptSvc),
			application.NewService(submitSvc),
			application.NewService(cliSvc),
			application.NewService(chatSvc),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "PinRu",
		Width:  1280,
		Height: 860,
		URL:    "/",
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
