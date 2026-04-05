pub mod models;

use sqlx::{sqlite::SqlitePoolOptions, Pool, Sqlite};
use std::fs;
use tauri::{App, Manager};

pub struct AppDb(pub Pool<Sqlite>);

pub fn init(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let app_dir = app
        .path()
        .app_config_dir()
        .expect("Failed to get app config dir");
    fs::create_dir_all(&app_dir)?;

    let db_path = app_dir.join("pinru.db");
    let db_url = format!("sqlite:{}?mode=rwc", db_path.display());

    let pool = tauri::async_runtime::block_on(async {
        SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&db_url)
            .await
    })?;

    // Run our own migrations using sqlx (execute each statement separately)
    let migration_sql: &str = include_str!("../../migrations/001_init.sql");
    tauri::async_runtime::block_on(async {
        for statement in migration_sql.split(';') {
            // Strip SQL comment lines before checking if the statement is empty
            let cleaned: String = statement
                .lines()
                .filter(|line| !line.trim_start().starts_with("--"))
                .collect::<Vec<_>>()
                .join("\n");
            let trimmed = cleaned.trim();
            if trimmed.is_empty() {
                continue;
            }
            sqlx::query(trimmed).execute(&pool).await?;
        }
        Ok::<(), sqlx::Error>(())
    })?;

    app.manage(AppDb(pool));

    Ok(())
}
