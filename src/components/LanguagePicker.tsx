import { Globe } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LANGUAGES, setLanguage, t, useLanguage } from "@/lib/i18n";

/** Interface language, each with how much of the interface is translated. */
export function LanguagePicker() {
  const language = useLanguage();
  return (
    <Select value={language} onValueChange={setLanguage}>
      <SelectTrigger size="sm" aria-label={t("app.language")} className="border-0 shadow-none">
        <Globe className="size-4" aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {LANGUAGES.map(({ code, name, percent }) => (
          <SelectItem key={code} value={code}>
            {t("app.languageOption", { name, percent })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
