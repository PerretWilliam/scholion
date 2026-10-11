import { DocSearch } from "@/components/chat/DocSearch";

// Search-only mode until the chat pipeline lands (Phase 6), where it remains the no-model mode.
export function ChatScreen() {
  return <DocSearch />;
}
