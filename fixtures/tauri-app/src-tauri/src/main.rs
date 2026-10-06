//! Updater fixture: started with FIXTURE_UPDATE_ENDPOINT and FIXTURE_RESULT_FILE,
//! it checks that endpoint, installs what it offers, writes the outcome and quits.

use tauri_plugin_updater::UpdaterExt;

async fn check_and_install(
    handle: &tauri::AppHandle,
    endpoint: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let current = handle.package_info().version.to_string();
    let updater = handle
        .updater_builder()
        .endpoints(vec![endpoint.parse()?])?
        .build()?;
    match updater.check().await? {
        Some(update) => {
            let version = update.version.clone();
            update.download_and_install(|_, _| {}, || {}).await?;
            Ok(format!("{current} installed {version}"))
        }
        None => Ok(format!("{current} none")),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let (Ok(endpoint), Ok(result_file)) = (
                std::env::var("FIXTURE_UPDATE_ENDPOINT"),
                std::env::var("FIXTURE_RESULT_FILE"),
            ) else {
                return Ok(());
            };
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let outcome = match check_and_install(&handle, &endpoint).await {
                    Ok(outcome) => outcome,
                    Err(error) => format!("error: {error}"),
                };
                let _ = std::fs::write(&result_file, outcome);
                handle.exit(0);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("the fixture app failed to start");
}
