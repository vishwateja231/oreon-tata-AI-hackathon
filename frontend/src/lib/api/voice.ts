/**
 * Voice agent API — the autonomous control turn.
 *
 * STT/TTS run in the browser (Web Speech API); this only carries the reasoning
 * turn: a transcribed utterance + history in, a structured spoken reply out.
 */
import { http } from "./client";

export interface VoiceTurn {
  role: "user" | "assistant";
  content: string;
}

export interface VoiceConverseRequest {
  query: string;
  history: VoiceTurn[];
  role: string;
  context_asset_id?: string | null;
  current_page?: string | null;
  recent_activity?: string[];
}

export interface ExecutionLogEntry {
  tool: string;
  label: string;
  kind: "read" | "write";
  status: "ok" | "error" | "skipped";
  detail?: string | null;
}

export interface ContextWidget {
  label: string;
  value: string;
  tone: "cyan" | "warn" | "crit" | "ok" | "violet";
}

export interface VoiceConverseResponse {
  spoken_response: string;
  plan_of_action: string[];
  execution_log: ExecutionLogEntry[];
  context_label?: string | null;
  widgets: ContextWidget[];
  llm_used: boolean;
}

export const voiceApi = {
  converse: (body: VoiceConverseRequest) =>
    http.post<VoiceConverseResponse>("/voice/converse", body),
};
