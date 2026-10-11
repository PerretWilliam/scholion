// Typed wrappers around the Tauri commands in src-tauri/src/commands.rs. Keep both in sync.
import { Channel, invoke } from "@tauri-apps/api/core";

/** One DevDocs manifest entry. Field names match DevDocs. */
export interface DocEntry {
  name: string;
  slug: string;
  type: string;
  version: string;
  release: string | null;
  mtime: number;
  db_size: number;
  /** HTML from DevDocs: sanitize before rendering. */
  attribution: string;
  alias: string | null;
  links: Record<string, string>;
}

export interface InstalledDoc {
  entry: DocEntry;
  update_available: boolean;
  newer_version: string | null;
}

export interface DocsOverview {
  /** Newest version first. Empty until the first manifest check. */
  available: DocEntry[];
  installed: InstalledDoc[];
  /** Unix seconds of the last manifest check, 0 if never. */
  checked_at: number;
}

export interface Settings {
  auto_update_docs: boolean;
  /** File name of the model used for answers. */
  active_model: string | null;
}

/** Emitted by the backend after the launch-time manifest check. */
export const DOCS_CHANGED_EVENT = "docs-changed";

export const getDocs = () => invoke<DocsOverview>("get_docs");

export const checkDocUpdates = () => invoke<DocsOverview>("check_doc_updates");

export function installDoc(slug: string, onProgress: (percent: number) => void) {
  const channel = new Channel<number>();
  channel.onmessage = onProgress;
  return invoke<void>("install_doc", { slug, onProgress: channel });
}

export const removeDoc = (slug: string) => invoke<void>("remove_doc", { slug });

export interface SearchHit {
  name: string;
  /** Entry path, possibly with a `#fragment`. */
  path: string;
  type: string;
  /** Official DevDocs page. */
  url: string;
}

export interface Page {
  path: string;
  title: string;
  /** Raw DevDocs HTML: sanitize before rendering. */
  html: string;
  url: string;
}

export const searchDoc = (slug: string, query: string, limit = 30) =>
  invoke<SearchHit[]>("search_doc", { slug, query, limit });

export const getPage = (slug: string, path: string) => invoke<Page>("get_page", { slug, path });

/** Port of a llama-server running `model` (a file name in the models directory). */
export const startLlm = (model: string) => invoke<number>("start_llm", { model });

export interface ModelStatus {
  /** File name in the models directory; also the model id. */
  file: string;
  name: string;
  description: string;
  repo: string;
  size: number;
  sha256: string;
  recommended: boolean;
  downloaded: boolean;
  /** Bytes of an unfinished download that can resume, 0 if none. */
  partial_bytes: number;
}

export interface ModelsOverview {
  models: ModelStatus[];
  /** File of the active model, null if none is downloaded. */
  active: string | null;
}

export const getModels = () => invoke<ModelsOverview>("get_models");

export function downloadModel(file: string, onProgress: (percent: number) => void) {
  const channel = new Channel<number>();
  channel.onmessage = onProgress;
  return invoke<void>("download_model", { file, onProgress: channel });
}

export const cancelModelDownload = (file: string) =>
  invoke<void>("cancel_model_download", { file });

export const removeModel = (file: string) => invoke<void>("remove_model", { file });

export const setActiveModel = (file: string) => invoke<void>("set_active_model", { file });

export const getSettings = () => invoke<Settings>("get_settings");

export const setSettings = (settings: Settings) => invoke<void>("set_settings", { settings });
