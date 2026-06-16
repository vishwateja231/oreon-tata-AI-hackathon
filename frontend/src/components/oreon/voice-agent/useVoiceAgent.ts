/**
 * useVoiceAgent — Deepgram-powered voice loop behind the sound-reactive orb.
 *
 * Pipeline:
 *   listen  → Records user microphone using MediaRecorder, feeds Web Audio AnalyserNode for orb,
 *             and POSTs the audio binary to /api/v1/voice/stt for Deepgram transcription.
 *   think   → POST the utterance + history to /api/v1/voice/converse.
 *   speak   → Plays Deepgram TTS audio stream from /api/v1/voice/tts, and pulses the orb.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { voiceApi, type VoiceConverseResponse, type VoiceTurn } from "@/lib/api/voice";
import { API_BASE } from "@/lib/api/client";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";

/** Live audio frequency bands the visualization reads every frame. */
export interface AudioLevels {
  bass: number;
  mid: number;
  high: number;
  amp: number;
}

interface UseVoiceAgentOpts {
  role: string;
  contextAssetId?: string | null;
  currentPage?: string | null;
  recentActivity?: string[];
}

function cleanTranscript(text: string): string {
  if (!text) return text;
  let cleaned = text;

  // Lowercase comparison map for exact or phrase matches
  // Normalizes spoken identifiers to their canonical form (e.g. "m twelve" -> "Motor_M12")
  const replacements: [RegExp, string][] = [
    // Motors
    [/\b(motor\s+)?m\s*(12|twelve)\b/gi, "Motor_M12"],
    // Conveyors
    [/\b(conveyor\s+)?c\s*(7|seven)\b/gi, "Conveyor_C7"],
    // Blast Furnace
    [/\b(blast\s+furnace\s+)?bf\s*(2|two)\b/gi, "BlastFurnace_BF2"],
    // Pumps
    [/\b(pump\s+)?p\s*(3|three)\b/gi, "Pump_P3"],
    // Cooling Systems
    [/\b(cooling\s+system\s+)?c\s*(1|one)\b/gi, "CoolingSystem_C1"],
    // Fans
    [/\b(fan\s+)?f\s*(2|two)\b/gi, "Fan_F2"],
    // Rolling Mills
    [/\b(rolling\s+mill\s+)?rm\s*(1|one)\b/gi, "RollingMill_RM1"],
    // Gearboxes
    [/\b(gearbox\s+)?g\s*(1|one)\b/gi, "Gearbox_G1"],
    // Crushers
    [/\b(crusher\s+)?cr\s*(1|one)\b/gi, "Crusher_CR1"],
    // Dust Collectors
    [/\b(dust\s+collector\s+)?dc\s*(1|one)\b/gi, "DustCollector_DC1"],
    // General abbreviations
    [/\b(lo\s*to|loto|lockout\s+tagout|lock\s+out\s+tag\s+out)\b/gi, "LOTO"],
    [/\b(rca|r\s*c\s*a)\b/gi, "RCA"],
    [/\b(rule|are\s+you\s+ell|r\s*u\s*l)\b/gi, "RUL"],
    [/\b(oh\s*ee\s*ee|o\s*e\s*e)\b/gi, "OEE"],
    [/\b(s\s*o\s*p|sop)\b/gi, "SOP"],
  ];

  for (const [regex, replacement] of replacements) {
    cleaned = cleaned.replace(regex, replacement);
  }
  return cleaned;
}

const ROLE_VOICES: Record<string, string> = {
  plant_manager: "aura-helios-en",
  maintenance_engineer: "aura-orpheus-en",
  reliability_engineer: "aura-angus-en",
  supervisor: "aura-percival-en",
  procurement_officer: "aura-luna-en",
  operator: "aura-asteria-en",
};

export function useVoiceAgent({ role, contextAssetId, currentPage, recentActivity }: UseVoiceAgentOpts) {
  const [state, setState] = useState<VoiceState>("idle");
  const [interim, setInterim] = useState("");
  const [lastUtterance, setLastUtterance] = useState("");
  const [response, setResponse] = useState<VoiceConverseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Prefer browser-native SpeechRecognition when available: it streams interim text
  // in real time, auto-stops on natural silence (no fixed record window) and needs no
  // Deepgram round-trip — far lower latency than the MediaRecorder→Deepgram path, and
  // it works even when the Deepgram key is absent.
  const [useNativeSTT, setUseNativeSTT] = useState(
    () => typeof window !== "undefined" && (!!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition),
  );
  const [voiceModel, setVoiceModel] = useState("aura-asteria-en");
  const [nativeVoice, setNativeVoice] = useState<SpeechSynthesisVoice | null>(null);

  const latestTranscriptRef = useRef("");

  const nativeSRSupported = typeof window !== "undefined" && (!!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition);
  const supported = typeof window !== "undefined" && ((!!navigator.mediaDevices && typeof MediaRecorder !== "undefined") || nativeSRSupported);

  // Live audio levels read by the orb every frame.
  const audioRef = useRef<AudioLevels>({ bass: 0, mid: 0, high: 0, amp: 0 });

  const historyRef = useRef<VoiceTurn[]>([]);
  const stateRef = useRef<VoiceState>("idle");

  // Web Audio plumbing for mic reactivity.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const freqDataRef = useRef<Uint8Array | null>(null);

  // Deepgram and native recognition elements
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);

  // Voice-activity detection for the Deepgram (MediaRecorder) fallback path — stops the
  // recording ~1.1s after the user stops talking instead of waiting a fixed window.
  const vadRef = useRef({ active: false, lastLoud: 0, everLoud: false });

  // Load premium native voice on mount
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      // Try to find a premium, natural-sounding English voice
      const preferred = voices.find(
        (v) =>
          v.lang.startsWith("en") &&
          (v.name.includes("Google") || v.name.includes("Natural") || v.name.includes("premium"))
      );
      const backup = voices.find((v) => v.lang.startsWith("en"));
      setNativeVoice(preferred || backup || null);
    };
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  // Update voiceModel dynamically when the active role changes
  useEffect(() => {
    setVoiceModel(ROLE_VOICES[role] || "aura-asteria-en");
  }, [role]);

  // Keep opts fresh inside long-lived callbacks.
  const optsRef = useRef({ role, contextAssetId, currentPage, recentActivity });
  useEffect(() => {
    optsRef.current = { role, contextAssetId, currentPage, recentActivity };
  }, [role, contextAssetId, currentPage, recentActivity]);

  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const resetSilenceTimer = useCallback((delay = 900) => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      if (useNativeSTT) {
        if (recognitionRef.current) {
          try {
            recognitionRef.current.stop();
          } catch (e) {
            console.warn("Error stopping native recognition in silence timer:", e);
          }
        }
      } else {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      }
    }, delay);
  }, [clearSilenceTimer, useNativeSTT]);

  const primeSpeech = useCallback(() => {
    // Left as no-op to maintain function signature; no browser gesture priming required for HTML5 Audio.
  }, []);

  const setPhase = useCallback((s: VoiceState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  // ── mic analyser loop ──────────────────────────────────────────────
  const startMicAnalyser = useCallback(async (): Promise<boolean> => {
    try {
      if (!micStreamRef.current) return false;
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      const ctx = audioCtxRef.current ?? new Ctx();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();
      const source = ctx.createMediaStreamSource(micStreamRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);
      analyserRef.current = analyser;
      freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        const a = analyserRef.current;
        const data = freqDataRef.current;
        if (a && data) {
          a.getByteFrequencyData(data as any);
          const band = (lo: number, hi: number) => {
            let sum = 0;
            for (let i = lo; i < hi; i++) sum += data[i];
            return sum / ((hi - lo) * 255);
          };
          audioRef.current = {
            bass: band(1, 8),
            mid: band(8, 40),
            high: band(40, 100),
            amp: band(1, 110),
          };

          // Silence-based auto-stop for the Deepgram recording path: once the user has
          // actually spoken, end the turn ~1.1s after they go quiet.
          const vad = vadRef.current;
          if (vad.active) {
            const now = performance.now();
            if (audioRef.current.amp > 0.04) {
              vad.lastLoud = now;
              vad.everLoud = true;
            }
            if (
              vad.everLoud &&
              now - vad.lastLoud > 1100 &&
              mediaRecorderRef.current &&
              mediaRecorderRef.current.state === "recording"
            ) {
              vad.active = false;
              try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
            }
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
      return true;
    } catch (err) {
      console.warn("Mic analyser unavailable:", err);
      return false;
    }
  }, []);

  // Cosmetic envelope so the globe still breathes while listening even if the
  // analyser couldn't open the mic.
  const startListenEnvelope = useCallback(() => {
    const start = performance.now();
    const loop = () => {
      if (stateRef.current !== "listening") return;
      const t = (performance.now() - start) / 1000;
      const e = 0.18 + Math.sin(t * 3.1) * 0.08 + Math.sin(t * 7.7) * 0.05;
      audioRef.current = { bass: e * 0.8, mid: e, high: e * 0.6, amp: Math.max(0.1, e) };
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const stopMicAnalyser = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    analyserRef.current = null;
    audioRef.current = { bass: 0, mid: 0, high: 0, amp: 0 };
  }, []);

  // ── speaking envelope (synthesized, since Audio stream output isn't directly tapped) ──
  const startSpeakEnvelope = useCallback(() => {
    let boundaryPulse = 0;
    const start = performance.now();
    const loop = () => {
      if (stateRef.current !== "speaking") return;
      const t = (performance.now() - start) / 1000;
      const wobble = 0.35 + Math.sin(t * 11) * 0.18 + Math.sin(t * 23) * 0.1;
      boundaryPulse *= 0.9;
      const energy = Math.max(0.12, Math.min(1, wobble + boundaryPulse));
      audioRef.current = {
        bass: energy * 0.9,
        mid: energy,
        high: energy * 0.7 + Math.random() * 0.05,
        amp: energy,
      };
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return {
      pulse: () => {
        boundaryPulse = 0.5;
      },
    };
  }, []);

  // ── Native Browser TTS Fallback ────────────────────────────────────
  const fallbackSpeak = useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !window.speechSynthesis) {
        setPhase("idle");
        return;
      }

      setPhase("speaking");
      const env = startSpeakEnvelope();
      env.pulse();

      const utterance = new SpeechSynthesisUtterance(text);
      if (nativeVoice) {
        utterance.voice = nativeVoice;
      }

      utterance.onend = () => {
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        audioRef.current = { bass: 0, mid: 0, high: 0, amp: 0 };
        setPhase("idle");
      };

      utterance.onerror = (err) => {
        console.error("SpeechSynthesisUtterance error:", err);
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        audioRef.current = { bass: 0, mid: 0, high: 0, amp: 0 };
        setPhase("idle");
      };

      window.speechSynthesis.speak(utterance);
    },
    [setPhase, startSpeakEnvelope, nativeVoice]
  );

  // ── TTS (Deepgram Backend Call) ──────────────────────────────────────
  const speak = useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !text) {
        setPhase("idle");
        return;
      }
      
      // Cancel any current audio playback
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current = null;
      }

      // Cancel SpeechSynthesis if active
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }

      setPhase("speaking");
      const env = startSpeakEnvelope();
      
      const apiBase = API_BASE;
      const voiceParam = voiceModel ? `&voice=${encodeURIComponent(voiceModel)}` : "";
      const audioUrl = `${apiBase}/api/v1/voice/tts?text=${encodeURIComponent(text)}${voiceParam}`;
      const audio = new Audio(audioUrl);
      ttsAudioRef.current = audio;
      
      audio.onplay = () => {
        env.pulse();
      };
      
      audio.onended = () => {
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        audioRef.current = { bass: 0, mid: 0, high: 0, amp: 0 };
        setPhase("idle");
        ttsAudioRef.current = null;
      };
      
      audio.onerror = () => {
        console.warn("Deepgram TTS failed; falling back to native speechSynthesis");
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        fallbackSpeak(text);
      };
      
      audio.play().catch((err) => {
        console.warn("Deepgram audio playback failed; falling back to native speechSynthesis:", err);
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        fallbackSpeak(text);
      });
    },
    [setPhase, startSpeakEnvelope, fallbackSpeak, voiceModel],
  );

  // ── reasoning turn ─────────────────────────────────────────────────
  const sendToAgent = useCallback(
    async (utterance: string) => {
      setPhase("thinking");
      setError(null);
      try {
        const result = await voiceApi.converse({
          query: utterance,
          history: historyRef.current.slice(-8),
          role: optsRef.current.role,
          context_asset_id: optsRef.current.contextAssetId ?? null,
          current_page: optsRef.current.currentPage ?? null,
          recent_activity: optsRef.current.recentActivity ?? [],
        });
        setResponse(result);
        historyRef.current.push({ role: "user", content: utterance });
        historyRef.current.push({ role: "assistant", content: result.spoken_response });
        speak(result.spoken_response);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Agent request failed";
        setError(msg);
        speak("Sorry, I couldn't reach the plant systems just now. Please try again.");
      }
    },
    [setPhase, speak],
  );

  // ── Native Browser Speech Recognition ──────────────────────────────
  const startNativeListening = useCallback(async () => {
    const SpeechRecognition = typeof window !== "undefined" && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    if (!SpeechRecognition) {
      setError("Native Speech Recognition is not supported in this browser.");
      setPhase("idle");
      return;
    }

    latestTranscriptRef.current = "";
    setLastUtterance("");
    setInterim("Priming native microphone...");
    setResponse(null);
    setError(null);
    setPhase("listening");

    try {
      // SpeechRecognition manages the microphone itself. Opening a second getUserMedia
      // stream for the analyser alongside it is a common cause of recognition silently
      // failing to capture — so drive the orb with the cosmetic envelope instead and let
      // SpeechRecognition be the sole mic consumer (far more reliable capture).
      startListenEnvelope();

      setInterim("Speak now...");

      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      let finalResultReceived = false;

      recognition.onresult = (event: any) => {
        let interimText = "";
        let finalTrans = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTrans += event.results[i][0].transcript;
          } else {
            interimText += event.results[i][0].transcript;
          }
        }
        const currentText = (finalTrans + interimText).trim();
        if (currentText) {
          setInterim(currentText);
          latestTranscriptRef.current = currentText;
        }
        if (finalTrans) {
          finalResultReceived = true;
          const utterance = cleanTranscript(finalTrans).trim();
          if (utterance) {
            setLastUtterance(utterance);
            setInterim("");
            stopMicAnalyser();
            sendToAgent(utterance);
          }
        }
      };

      recognition.onerror = (event: any) => {
        console.error("Native SpeechRecognition error:", event.error);
        if (event.error === "network" || event.error === "service-not-allowed") {
          // The browser's STT service is unreachable — switch to the Deepgram path so
          // the next attempt still works.
          setUseNativeSTT(false);
          setError("Switched to cloud transcription — tap the sphere and speak again.");
        } else if (event.error === "no-speech") {
          setError("I didn't hear anything — tap the sphere and speak.");
        } else if (event.error !== "aborted") {
          setError(`Speech recognition error: ${event.error}`);
        }
        stopMicAnalyser();
        setPhase("idle");
      };

      recognition.onend = () => {
        if (stateRef.current === "listening" && !finalResultReceived) {
          stopMicAnalyser();
          setPhase("idle");
          setError("I didn't hear anything — tap the sphere and speak.");
        }
      };

      recognition.start();
      resetSilenceTimer(8000);

    } catch (err) {
      console.error("Native recognition mic access failed:", err);
      setError("Microphone is blocked or unavailable. Allow access and try again.");
      setPhase("idle");
    }
  }, [sendToAgent, setPhase, startMicAnalyser, startListenEnvelope, stopMicAnalyser, resetSilenceTimer]);

  // ── Unified Stop Function ──────────────────────────────────────────
  const stop = useCallback(() => {
    clearSilenceTimer();
    vadRef.current.active = false;

    // Stop recording
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {
        console.warn("Error stopping media recorder in stop:", e);
      }
    }

    // Stop SpeechRecognition (both native and parallel)
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        // ignore
      }
    }

    // Stop mic analysis
    stopMicAnalyser();

    // Stop Deepgram TTS audio playback
    if (ttsAudioRef.current) {
      try {
        ttsAudioRef.current.pause();
      } catch (e) {
        // ignore
      }
      ttsAudioRef.current = null;
    }

    // Stop SpeechSynthesis
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    // Stop animation frame
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // Reset audio levels
    audioRef.current = { bass: 0, mid: 0, high: 0, amp: 0 };

    setPhase("idle");
  }, [clearSilenceTimer, stopMicAnalyser, setPhase]);

  const stopListening = useCallback(() => {
    stop();
  }, [stop]);

  const startListening = useCallback(async () => {
    // Stop any current processes/audio first
    stop();

    if (useNativeSTT) {
      await startNativeListening();
      return;
    }

    latestTranscriptRef.current = "";
    setLastUtterance("");
    setInterim("Priming microphone...");
    setResponse(null);
    setError(null);
    setPhase("listening");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      
      const analyzerOk = await startMicAnalyser();
      if (!analyzerOk && stateRef.current === "listening") {
        startListenEnvelope();
      }

      setInterim("Speak now...");
      
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        vadRef.current.active = false;
        // Stop the parallel SpeechRecognition if it was running
        if (recognitionRef.current && !useNativeSTT) {
          try {
            recognitionRef.current.stop();
          } catch (e) {
            // ignore
          }
        }

        setPhase("thinking");
        setInterim("Transcribing speech...");

        const backupUtterance = latestTranscriptRef.current.trim();

        try {
          const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          const formData = new FormData();
          formData.append("file", audioBlob, "audio.webm");

          const apiBase = API_BASE;
          const res = await fetch(`${apiBase}/api/v1/voice/stt`, {
            method: "POST",
            body: formData,
          });

          if (!res.ok) {
            throw new Error(`STT request failed: ${res.statusText}`);
          }

          const data = await res.json();
          let utterance = data.transcript ? cleanTranscript(data.transcript).trim() : "";

          // Fallback to parallel STT transcript if Deepgram returned empty but parallel got something
          if (!utterance && backupUtterance) {
            console.log("Deepgram returned empty transcript; falling back to parallel SpeechRecognition:", backupUtterance);
            utterance = cleanTranscript(backupUtterance).trim();
          }

          if (utterance) {
            setLastUtterance(utterance);
            setInterim("");
            sendToAgent(utterance);
          } else {
            setError("I didn't hear anything — tap the sphere and speak.");
            setPhase("idle");
          }
        } catch (err) {
          console.error("Deepgram STT transcription failed, checking fallback:", err);
          
          if (backupUtterance) {
            console.log("Deepgram failed; falling back to parallel SpeechRecognition transcript:", backupUtterance);
            const utterance = cleanTranscript(backupUtterance).trim();
            setLastUtterance(utterance);
            setInterim("");
            sendToAgent(utterance);
          } else {
            setUseNativeSTT(true);
            setError("Deepgram STT failed. Switched to native speech recognition. Please speak again.");
            setPhase("idle");
          }
        }
      };

      // Start browser SpeechRecognition in parallel to provide real-time visual feedback
      const SpeechRecognition = typeof window !== "undefined" && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
      if (SpeechRecognition) {
        try {
          const parallelRec = new SpeechRecognition();
          recognitionRef.current = parallelRec;
          parallelRec.continuous = true;
          parallelRec.interimResults = true;
          parallelRec.lang = "en-US";

          parallelRec.onresult = (event: any) => {
            let interimText = "";
            let finalTrans = "";
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              if (event.results[i].isFinal) {
                finalTrans += event.results[i][0].transcript;
              } else {
                interimText += event.results[i][0].transcript;
              }
            }
            const currentText = (finalTrans + interimText).trim();
            if (currentText) {
              setInterim(currentText);
              latestTranscriptRef.current = currentText;
            }
          };

          parallelRec.onerror = (event: any) => {
            console.warn("Parallel SpeechRecognition error (non-fatal):", event.error);
          };

          parallelRec.start();
        } catch (e) {
          console.warn("Failed to start parallel SpeechRecognition:", e);
        }
      }

      vadRef.current = { active: true, lastLoud: performance.now(), everLoud: false };
      mediaRecorder.start();

      // Silence detection (in the analyser tick) ends the turn naturally; this is only a
      // hard safety cap for a very long utterance or a mic with no measurable level.
      resetSilenceTimer(12000);

    } catch (err) {
      console.error("Mic access failed:", err);
      setError("Microphone is blocked or unavailable. Allow access and try again.");
      setPhase("idle");
    }
  }, [sendToAgent, setPhase, startMicAnalyser, startListenEnvelope, stopMicAnalyser, resetSilenceTimer, useNativeSTT, startNativeListening, stop]);

  const toggle = useCallback(() => {
    const s = stateRef.current;
    if (s === "listening" || s === "speaking" || s === "thinking") {
      stop();
    } else if (s === "idle") {
      startListening();
    }
  }, [startListening, stop]);

  // Text-input fallback
  const submitText = useCallback(
    (text: string) => {
      const utterance = text.trim();
      if (!utterance || stateRef.current === "thinking") return;
      
      stop();
      setLastUtterance(utterance);
      setInterim("");
      sendToAgent(utterance);
    },
    [sendToAgent, stop],
  );

  const reset = useCallback(() => {
    stop();
    historyRef.current = [];
    setResponse(null);
    setLastUtterance("");
    setInterim("");
    setError(null);
  }, [stop]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stop();
      audioCtxRef.current?.close().catch(() => {});
    };
  }, [stop]);

  return {
    state,
    interim,
    lastUtterance,
    response,
    error,
    supported,
    audioRef,
    hasHistory: historyRef.current.length > 0,
    toggle,
    startListening,
    stopListening,
    submitText,
    reset,
    useNativeSTT,
    setUseNativeSTT,
    stop,
  };
}
