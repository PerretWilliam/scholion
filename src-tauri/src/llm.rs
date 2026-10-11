//! Lifecycle of the bundled `llama-server`: spawn on a free local port, wait until the model is
//! loaded, kill on drop. Flags are documented in docs/architecture.md.

use std::fs::File;
use std::net::TcpListener;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use tokio::time::{Instant, sleep};

use crate::error::{AppError, Result};

/// Loading a large model from a slow disk can take a while.
const LOAD_TIMEOUT: Duration = Duration::from_secs(300);
const CONTEXT_TOKENS: &str = "4096";

/// The webview origin allowed by CORS. llama-server echoes `--cors-origins` verbatim in
/// `Access-Control-Allow-Origin`, so it must be exactly one origin.
const APP_ORIGIN: &str = if cfg!(debug_assertions) {
    "http://localhost:1420" // Vite dev server
} else if cfg!(windows) {
    "http://tauri.localhost"
} else {
    "tauri://localhost"
};

/// A running server. Dropping it kills the process.
pub struct LlmServer {
    child: Child,
    pub port: u16,
    pub model: PathBuf,
}

impl LlmServer {
    pub fn is_running(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }
}

impl Drop for LlmServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Spawns `llama-server` from `bin_dir` with `model` on a free local port. Output goes to `log`.
/// The model is still loading when this returns: see [`wait_until_ready`].
pub fn spawn(bin_dir: &Path, model: &Path, log: &Path) -> Result<LlmServer> {
    let port = TcpListener::bind(("127.0.0.1", 0))?.local_addr()?.port();
    let log_file = File::create(log)?;
    let mut command =
        Command::new(bin_dir.join(format!("llama-server{}", std::env::consts::EXE_SUFFIX)));
    command
        .arg("--model")
        .arg(model)
        .args(["--host", "127.0.0.1", "--port", &port.to_string()])
        .args(["--ctx-size", CONTEXT_TOKENS, "--n-gpu-layers", "99"])
        .args(["--reasoning-budget", "0", "--no-webui"])
        .args(["--cors-origins", APP_ORIGIN, "--no-cors-credentials"])
        .stdin(Stdio::null())
        .stdout(log_file.try_clone()?)
        .stderr(log_file);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let child = command
        .spawn()
        .map_err(|e| AppError::other(format!("Could not start llama-server: {e}")))?;
    Ok(LlmServer {
        child,
        port,
        model: model.to_owned(),
    })
}

/// Polls `/health` until the model is loaded. `alive` reports whether the process still runs.
pub async fn wait_until_ready(
    port: u16,
    log: &Path,
    mut alive: impl FnMut() -> bool,
) -> Result<()> {
    // Local traffic must never go through a system proxy.
    let http = reqwest::Client::builder().no_proxy().build()?;
    let health = format!("http://127.0.0.1:{port}/health");
    let deadline = Instant::now() + LOAD_TIMEOUT;
    loop {
        if !alive() {
            return Err(AppError::other(format!(
                "llama-server stopped while loading the model. See {}",
                log.display()
            )));
        }
        // 503 while the model loads, 200 once ready.
        if let Ok(response) = http.get(&health).send().await
            && response.status().is_success()
        {
            return Ok(());
        }
        if Instant::now() > deadline {
            return Err(AppError::other(format!(
                "llama-server did not load the model within {} s. See {}",
                LOAD_TIMEOUT.as_secs(),
                log.display()
            )));
        }
        sleep(Duration::from_millis(250)).await;
    }
}

/// Model files are addressed by bare file name inside the models directory.
pub fn validate_model_file(name: &str) -> Result<()> {
    let is_file_name = Path::new(name).file_name().is_some_and(|f| f == name);
    if is_file_name && name.ends_with(".gguf") && !name.starts_with('.') {
        Ok(())
    } else {
        Err(AppError::other(format!("Invalid model file: {name}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_file_names() {
        assert!(validate_model_file("Qwen3.5-4B-Q4_K_M.gguf").is_ok());
        for bad in ["../x.gguf", "a/b.gguf", "/x.gguf", "x.bin", ".gguf", ""] {
            assert!(validate_model_file(bad).is_err(), "{bad}");
        }
    }

    /// Needs `pnpm fetch:llama` and a GGUF file: AIDOC_LIVE_MODEL=/path/model.gguf
    #[tokio::test]
    #[ignore]
    async fn live_start_and_chat() {
        let model = PathBuf::from(std::env::var("AIDOC_LIVE_MODEL").expect("AIDOC_LIVE_MODEL"));
        let bin_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/llama");
        let log = tempfile::NamedTempFile::new().unwrap();
        let mut server = spawn(&bin_dir, &model, log.path()).unwrap();
        wait_until_ready(server.port, log.path(), || server.is_running())
            .await
            .unwrap();

        let body = serde_json::json!({
            "messages": [{ "role": "user", "content": "Say hi." }],
            "max_tokens": 8,
        });
        let response: serde_json::Value = reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .post(format!(
                "http://127.0.0.1:{}/v1/chat/completions",
                server.port
            ))
            .json(&body)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert!(
            response["choices"][0]["message"]["content"].is_string(),
            "{response}"
        );

        // CORS only allows the app origin.
        let preflight = reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .request(
                reqwest::Method::OPTIONS,
                format!("http://127.0.0.1:{}/v1/chat/completions", server.port),
            )
            .header("Origin", "https://evil.example")
            .header("Access-Control-Request-Method", "POST")
            .send()
            .await
            .unwrap();
        // Browsers reject the response unless this matches their own origin.
        assert_eq!(
            preflight.headers()["access-control-allow-origin"],
            APP_ORIGIN
        );

        // Dropping the handle kills the server.
        let health = format!("http://127.0.0.1:{}/health", server.port);
        drop(server);
        sleep(Duration::from_millis(500)).await;
        assert!(reqwest::get(health).await.is_err());
    }
}
