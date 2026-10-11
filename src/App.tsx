import { MessageSquare, Settings } from "lucide-react";
import { useState } from "react";
import { ChatScreen } from "@/components/chat/ChatScreen";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { Button } from "@/components/ui/button";

type Screen = "chat" | "settings";

export default function App() {
  const [screen, setScreen] = useState<Screen>("chat");

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="font-semibold text-sm">ai-doc</h1>
        <nav className="flex gap-1" aria-label="Main">
          <Button
            variant={screen === "chat" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setScreen("chat")}
          >
            <MessageSquare /> Chat
          </Button>
          <Button
            variant={screen === "settings" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setScreen("settings")}
          >
            <Settings /> Settings
          </Button>
        </nav>
      </header>
      {/* The chat stays mounted so the conversation survives a visit to Settings. */}
      <main className="min-h-0 flex-1" hidden={screen !== "chat"}>
        <ChatScreen visible={screen === "chat"} />
      </main>
      {screen === "settings" && (
        <main className="min-h-0 flex-1 overflow-auto">
          <SettingsScreen />
        </main>
      )}
    </div>
  );
}
