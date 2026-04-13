package main

import (
	"embed"
	"log"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/lmittmann/tint"

	appchat "github.com/blueship581/pinru/app/chat"
	appcli "github.com/blueship581/pinru/app/cli"
	appconfig "github.com/blueship581/pinru/app/config"
	appgit "github.com/blueship581/pinru/app/git"
	appjob "github.com/blueship581/pinru/app/job"
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
	slog.SetDefault(slog.New(tint.NewHandler(os.Stderr, &tint.Options{
		Level:      slog.LevelInfo,
		TimeFormat: time.TimeOnly,
	})))

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
	submitSvc := appsubmit.New(db)
	cliSvc := appcli.New()
	promptSvc := appprompt.New(db, cliSvc)
	chatSvc := appchat.New(db, cliSvc)
	jobSvc := appjob.New(db, promptSvc, gitSvc, submitSvc)

	// Pre-install bundled skills and execution manuals on every launch.
	// Manuals are extracted to ~/.pinru/manuals/; skills are written to
	// ~/.claude/skills/ with the manual dir path substituted in.
	cliSvc.InstallBuiltinManuals()
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
			application.NewService(jobSvc),
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
