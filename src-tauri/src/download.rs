use std::path::Path;

use tokio::io::AsyncWriteExt;

use crate::error::Result;

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
