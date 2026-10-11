import { MessageSquare, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { ChatScreen } from "@/components/chat/ChatScreen";
import { LanguagePicker } from "@/components/LanguagePicker";
import { Logo } from "@/components/Logo";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { Button } from "@/components/ui/button";
import { Welcome } from "@/components/Welcome";
import { t, useLanguage } from "@/lib/i18n";
import { getDocs, getModels } from "@/lib/ipc";

type Screen = "welcome" | "chat" | "settings";

export default function App() {
  useLanguage();
  const [screen, setScreen] = useState<Screen>("chat");

  // First launch, or everything was removed: offer a model and docs.
  useEffect(() => {
    Promise.all([getModels(), getDocs()])
      .then(([models, docs]) => {
        if (!models.models.some((m) => m.downloaded) && docs.installed.length === 0) {
          setScreen("welcome");
        }
      })
      // The chat screen loads the same data and reports the error.
      .catch(() => {});
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="flex items-center gap-2 font-semibold text-sm">
          <Logo />
          Scholion
        </h1>
        <nav className="flex items-center gap-1" aria-label={t("app.mainNav")}>
          <Button
            variant={screen === "chat" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setScreen("chat")}
          >
            <MessageSquare /> {t("app.chat")}
          </Button>
          <Button
            variant={screen === "settings" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setScreen("settings")}
          >
            <Settings /> {t("app.settings")}
          </Button>
          <LanguagePicker />
        </nav>
      </header>
      {/* The chat stays mounted so the conversation survives a visit to Settings. */}
      <main className="min-h-0 flex-1" hidden={screen !== "chat"}>
        <ChatScreen visible={screen === "chat"} onOpenSettings={() => setScreen("settings")} />
      </main>
      {screen === "welcome" && (
        <main className="min-h-0 flex-1 overflow-auto">
          <Welcome onDone={() => setScreen("chat")} />
        </main>
      )}
      {screen === "settings" && (
        <main className="min-h-0 flex-1 overflow-auto">
          <SettingsScreen />
        </main>
      )}
    </div>
  );
}
