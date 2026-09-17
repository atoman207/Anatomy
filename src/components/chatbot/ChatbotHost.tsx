"use client";

import { VoiceChatbotPanel } from "./VoiceChatbotPanel";
import { VideoChatbotPanel } from "./VideoChatbotPanel";

/**
 * Hosts the app-wide floating chatbots inside the app shell (guests included).
 * Left = voice, right = video (camera + conversation).
 */
export function ChatbotHost({
  voiceOpen,
  videoOpen,
  onVoiceClose,
  onVideoClose,
  fallbackLabId,
  historyScope,
}: {
  voiceOpen: boolean;
  videoOpen: boolean;
  onVoiceClose: () => void;
  onVideoClose: () => void;
  fallbackLabId: string | null;
  historyScope: string;
}) {
  return (
    <>
      <VoiceChatbotPanel
        open={voiceOpen}
        onClose={onVoiceClose}
        fallbackLabId={fallbackLabId}
        historyScope={historyScope}
      />
      <VideoChatbotPanel
        open={videoOpen}
        onClose={onVideoClose}
        fallbackLabId={fallbackLabId}
        historyScope={historyScope}
      />
    </>
  );
}
