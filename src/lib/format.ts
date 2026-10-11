import { currentLanguage, t } from "@/lib/i18n";
import type { DocEntry } from "@/lib/ipc";

const UNITS = ["B", "KB", "MB", "GB"];

/** Decimal units, as disk and download sizes are usually shown. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  const number =
    unit === 0
      ? String(value)
      : value.toLocaleString(currentLanguage(), {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        });
  return `${number} ${UNITS[unit]}`;
}

/** "Python 3.15.0", "Angular 22.0.0", or just "C" when DevDocs gives no version. */
export function docTitle(doc: DocEntry): string {
  const version = doc.release || doc.version;
  return version ? `${doc.name} ${version}` : doc.name;
}

export function formatCheckedAt(unixSeconds: number): string {
  return unixSeconds === 0
    ? t("docs.never")
    : new Date(unixSeconds * 1000).toLocaleString(currentLanguage());
}
