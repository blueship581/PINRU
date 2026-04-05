mod commands;
mod db;
mod services;

use tauri::menu::{AboutMetadataBuilder, MenuBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri_plugin_sql::{Migration, MigrationKind};

fn build_app_menu(app: &tauri::App) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let about = AboutMetadataBuilder::new()
        .name(Some("PinRu".to_string()))
        .version(Some("0.1.0".to_string()))
        .build();

    let app_menu = SubmenuBuilder::new(app, "PinRu")
        .item(&PredefinedMenuItem::about(app, None, Some(about))?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    MenuBuilder::new(app)
        .item(&app_menu)
        .item(&edit_menu)
        .item(&window_menu)
        .build()
}

pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create initial tables",
        sql: include_str!("../migrations/001_init.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:pinru.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let menu = build_app_menu(app)?;
            app.set_menu(menu)?;
            db::init(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::config::get_config,
            commands::config::set_config,
            commands::config::test_gitlab_connection,
            commands::config::test_github_connection,
            commands::config::pick_directory,
            commands::task::list_tasks,
            commands::task::get_task,
            commands::task::create_task,
            commands::task::list_model_runs,
            commands::task::update_task_status,
            commands::task::update_model_run,
            commands::task::delete_task,
            commands::submit::publish_source_repo,
            commands::submit::submit_model_run,
            commands::git::fetch_gitlab_project,
            commands::git::fetch_gitlab_projects,
            commands::git::clone_project,
            commands::git::download_gitlab_project,
            commands::git::copy_project_directory,
            commands::git::check_paths_exist,
            commands::prompt::test_llm_provider,
            commands::prompt::generate_task_prompt,
            commands::prompt::save_task_prompt,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
