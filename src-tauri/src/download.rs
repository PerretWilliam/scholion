use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use reqwest::StatusCode;
use reqwest::header::RANGE;
use tokio::io::AsyncWriteExt;

use crate::error::{AppError, Result};

/// Streams `url` into `dest`, calling `on_progress` with the bytes written so far.
pub async fn download(
    http: &reqwest::Client,
    url: &str,
    dest: &Path,
    mut on_progress: impl FnMut(u64),
) -> Result<()> {
    let mut response = http.get(url).send().await?.error_for_status()?;
    let mut file = tokio::fs::File::create(dest).await?;
    let mut written = 0;
    while let Some(chunk) = response.chunk().await? {
        file.write_all(&chunk).await?;
        written += chunk.len() as u64;
        on_progress(written);
    }
    file.flush().await?;
    Ok(())
}

/// Like [`download`], but appends to an existing `dest` when the server honors a `Range` request,
/// and stops with an error once `cancel` is set. The partial file is kept either way.
pub async fn download_resumable(
    http: &reqwest::Client,
    url: &str,
    dest: &Path,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(u64),
) -> Result<()> {
    let have = tokio::fs::metadata(dest).await.map_or(0, |m| m.len());
    let mut request = http.get(url);
    if have > 0 {
        request = request.header(RANGE, format!("bytes={have}-"));
    }
    let response = request.send().await?;
    if have > 0 && response.status() == StatusCode::RANGE_NOT_SATISFIABLE {
        return Ok(()); // Already complete; the caller verifies the content.
    }
    let mut response = response.error_for_status()?;
    let resumed = response.status() == StatusCode::PARTIAL_CONTENT;
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(resumed)
        .truncate(!resumed)
        .open(dest)
        .await?;
    let mut written = if resumed { have } else { 0 };
    on_progress(written);
    while let Some(chunk) = response.chunk().await? {
        if cancel.load(Ordering::Relaxed) {
            file.flush().await?;
            return Err(AppError::other("Download cancelled"));
        }
        file.write_all(&chunk).await?;
        written += chunk.len() as u64;
        on_progress(written);
    }
    file.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    use super::*;

    /// Serves `body` on a local port for `requests` requests, honoring `Range: bytes=N-`.
    fn serve(body: &'static [u8], requests: usize) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/file", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            for stream in listener.incoming().take(requests) {
                let mut stream = stream.unwrap();
                let mut buf = [0; 4096];
                let n = stream.read(&mut buf).unwrap();
                let request = String::from_utf8_lossy(&buf[..n]).to_lowercase();
                let start = request
                    .split("range: bytes=")
                    .nth(1)
                    .and_then(|r| r.split('-').next()?.parse::<usize>().ok());
                let (status, part) = match start {
                    Some(s) if s >= body.len() => ("416 Range Not Satisfiable", &body[..0]),
                    Some(s) => ("206 Partial Content", &body[s..]),
                    None => ("200 OK", body),
                };
                let head = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    part.len()
                );
                stream.write_all(head.as_bytes()).unwrap();
                stream.write_all(part).unwrap();
            }
        });
        url
    }

    #[tokio::test]
    async fn resumes_partial_downloads() {
        let body = b"0123456789abcdef";
        let url = serve(body, 3);
        let http = reqwest::Client::builder().no_proxy().build().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("file.part");
        let cancel = AtomicBool::new(false);

        // Resume from 10 bytes: only the rest is fetched and appended.
        std::fs::write(&dest, &body[..10]).unwrap();
        let mut progress = Vec::new();
        download_resumable(&http, &url, &dest, &cancel, |n| progress.push(n))
            .await
            .unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), body);
        assert_eq!(progress, [10, 16]);

        // Already complete: 416 leaves the file as is.
        download_resumable(&http, &url, &dest, &cancel, |_| {})
            .await
            .unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), body);

        // Fresh download.
        std::fs::remove_file(&dest).unwrap();
        download_resumable(&http, &url, &dest, &cancel, |_| {})
            .await
            .unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), body);
    }
}
