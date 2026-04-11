package main

import (
	"embed"
	"log"
	"os"
	"path/filepath"

	appchat "github.com/blueship581/pinru/app/chat"
	appcli "github.com/blueship581/pinru/app/cli"
	appconfig "github.com/blueship581/pinru/app/config"
	appgit "github.com/blueship581/pinru/app/git"
	appprompt "github.com/blueship581/pinru/app/prompt"
	appsubmit "github.com/blueship581/pinru/app/submit"
	apptask "github.com/blueship581/pinru/app/task"
	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/migrations"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	home, _ := os.UserHomeDir()
	dbPath := filepath.Join(home, ".pinru", "pinru.db")

	db, err := store.Open(dbPath, migrations.All()...)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer db.Close()

	configSvc := appconfig.New(db)
	gitSvc := appgit.New(db)
	taskSvc := apptask.New(db, gitSvc)
	promptSvc := appprompt.New(db)
	submitSvc := appsubmit.New(db)
	cliSvc := appcli.New()
	chatSvc := appchat.New(db, cliSvc)

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
