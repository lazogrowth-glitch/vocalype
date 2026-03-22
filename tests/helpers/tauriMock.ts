import type { Page } from "@playwright/test";

const mockSettings = {
  bindings: {},
  push_to_talk: false,
  audio_feedback: false,
  audio_feedback_volume: 1,
  sound_theme: "marimba",
  start_hidden: false,
  autostart_enabled: false,
  update_checks_enabled: true,
  selected_model: "",
  always_on_microphone: false,
  recording_mode: "toggle",
  selected_microphone: null,
  selected_microphone_index: null,
  clamshell_microphone: null,
  clamshell_microphone_index: null,
  selected_output_device: null,
  translate_to_english: false,
  selected_language: "auto",
  overlay_position: "bottom",
  debug_mode: false,
  log_level: "info",
  custom_words: [],
  adaptive_vocabulary_enabled: false,
  adaptive_voice_profile_enabled: false,
  model_unload_timeout: "never",
  word_correction_threshold: 0.18,
  history_limit: 50,
  recording_retention_period: "preserve_limit",
  paste_method: "ctrl_v",
  clipboard_handling: "dont_modify",
  auto_submit: false,
  auto_submit_key: "enter",
  post_process_enabled: false,
  post_process_provider_id: "openai",
  post_process_providers: [],
  post_process_api_keys: {},
  post_process_models: {},
  post_process_prompts: [],
  post_process_selected_prompt_id: null,
  mute_while_recording: false,
  append_trailing_space: false,
  app_language: "en",
  experimental_enabled: false,
  keyboard_implementation: "tauri",
  show_tray_icon: true,
  paste_delay_ms: 60,
  typing_tool: "enigo",
  external_script_path: null,
  long_audio_model: null,
  long_audio_threshold_seconds: 120,
  gemini_api_key: null,
  gemini_model: "gemini-1.5-flash",
  post_process_actions: [],
  saved_processing_models: [],
  adaptive_profile_applied: false,
  adaptive_machine_profile: null,
  app_context_enabled: true,
  whisper_mode: false,
  voice_snippets: [],
};

export async function injectTauriMock(
  page: Page,
  options?: { windowLabel?: string },
) {
  await page.addInitScript(
    ({ windowLabel, settings }) => {
      const callbacks = new Map<number, (payload: unknown) => void>();
      const eventListeners = new Map<string, number[]>();
      const stores = new Map<number, Map<string, unknown>>();
      const storePaths = new Map<string, number>();
      let nextCallbackId = 1;
      let nextResourceId = 1;

      const internals =
        (window as Window & { __TAURI_INTERNALS__?: Record<string, unknown> })
          .__TAURI_INTERNALS__ ?? {};
      const eventInternals =
        (
          window as Window & {
            __TAURI_EVENT_PLUGIN_INTERNALS__?: Record<string, unknown>;
          }
        ).__TAURI_EVENT_PLUGIN_INTERNALS__ ?? {};

      const registerCallback = (
        callback?: (payload: unknown) => void,
        once = false,
      ) => {
        const id = nextCallbackId++;
        callbacks.set(id, (payload: unknown) => {
          if (once) {
            callbacks.delete(id);
          }
          callback?.(payload);
        });
        return id;
      };

      const unregisterCallback = (id: number) => {
        callbacks.delete(id);
      };

      const runCallback = (id: number, payload: unknown) => {
        callbacks.get(id)?.(payload);
      };

      const unregisterListener = (event: string, id: number) => {
        unregisterCallback(id);
        const listeners = eventListeners.get(event);
        if (!listeners) {
          return;
        }
        const index = listeners.indexOf(id);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      };

      const ensureStore = (rid: number) => {
        const existing = stores.get(rid);
        if (existing) {
          return existing;
        }
        const created = new Map<string, unknown>();
        stores.set(rid, created);
        return created;
      };

      const loadStore = (path: string) => {
        const existing = storePaths.get(path);
        if (existing) {
          ensureStore(existing);
          return existing;
        }
        const rid = nextResourceId++;
        storePaths.set(path, rid);
        stores.set(rid, new Map<string, unknown>());
        return rid;
      };

      const emitEvent = (event: string, payload: unknown) => {
        const listeners = eventListeners.get(event) ?? [];
        for (const handlerId of listeners) {
          runCallback(handlerId, { event, id: handlerId, payload });
        }
      };

      const invoke = async (cmd: string, args?: Record<string, unknown>) => {
        switch (cmd) {
          case "plugin:event|listen": {
            const event = String(args?.event ?? "");
            const handler = Number(args?.handler ?? 0);
            const listeners = eventListeners.get(event) ?? [];
            listeners.push(handler);
            eventListeners.set(event, listeners);
            return handler;
          }
          case "plugin:event|emit":
            emitEvent(String(args?.event ?? ""), args?.payload);
            return null;
          case "plugin:event|unlisten":
            unregisterListener(
              String(args?.event ?? ""),
              Number(args?.eventId ?? args?.id ?? 0),
            );
            return null;
          case "plugin:store|load":
            return loadStore(String(args?.path ?? "mock.store.json"));
          case "plugin:store|get_store": {
            const path = String(args?.path ?? "mock.store.json");
            return storePaths.get(path) ?? null;
          }
          case "plugin:store|get": {
            const store = ensureStore(Number(args?.rid ?? 0));
            const key = String(args?.key ?? "");
            return [store.get(key), store.has(key)];
          }
          case "plugin:store|set": {
            const store = ensureStore(Number(args?.rid ?? 0));
            store.set(String(args?.key ?? ""), args?.value);
            return null;
          }
          case "plugin:store|has": {
            const store = ensureStore(Number(args?.rid ?? 0));
            return store.has(String(args?.key ?? ""));
          }
          case "plugin:store|delete": {
            const store = ensureStore(Number(args?.rid ?? 0));
            store.delete(String(args?.key ?? ""));
            return null;
          }
          case "plugin:store|clear":
          case "plugin:store|reset": {
            ensureStore(Number(args?.rid ?? 0)).clear();
            return null;
          }
          case "plugin:store|keys":
            return Array.from(ensureStore(Number(args?.rid ?? 0)).keys());
          case "plugin:store|values":
            return Array.from(ensureStore(Number(args?.rid ?? 0)).values());
          case "plugin:store|entries":
            return Array.from(ensureStore(Number(args?.rid ?? 0)).entries());
          case "plugin:store|length":
            return ensureStore(Number(args?.rid ?? 0)).size;
          case "plugin:store|reload":
          case "plugin:store|save":
          case "plugin:resources|close":
            return null;
          case "plugin:app|version":
            return "0.7.17-test";
          case "plugin:app|name":
            return "Vocalype";
          case "plugin:app|tauri_version":
            return "2.0.0-test";
          case "plugin:app|identifier":
            return "com.vocalype.desktop";
          case "get_secure_auth_token":
          case "get_secure_auth_session":
          case "get_secure_license_bundle":
          case "load_secure_auth_token":
            return null;
          case "set_secure_auth_token":
          case "set_secure_auth_session":
          case "clear_secure_auth_token":
          case "clear_secure_auth_session":
          case "set_secure_license_bundle":
          case "clear_secure_license_bundle":
            return null;
          case "get_machine_device_id":
            return "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
          case "get_license_runtime_state":
            return { state: "expired", reason: "mock-runtime" };
          case "get_integrity_snapshot":
            return {
              release_build: false,
              binary_sha256: null,
              tamper_flags: [],
              executable_path: null,
            };
          case "get_app_settings":
          case "get_default_settings":
            return settings;
          case "check_custom_sounds":
            return { start: false, stop: false };
          case "get_available_models":
            return [];
          case "get_current_model":
            return "";
          case "has_any_models_available":
            return false;
          case "get_available_microphones":
          case "get_available_output_devices":
            return [];
          default:
            return null;
        }
      };

      Object.assign(internals, {
        invoke,
        transformCallback: registerCallback,
        unregisterCallback,
        runCallback,
        callbacks,
        convertFileSrc: (src: string) => src,
        metadata: {
          currentWindow: { label: windowLabel },
          currentWebview: { windowLabel, label: windowLabel },
        },
      });
      Object.assign(eventInternals, {
        unregisterListener,
      });

      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        value: internals,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
        value: eventInternals,
        writable: true,
        configurable: true,
      });
    },
    { windowLabel: options?.windowLabel ?? "main", settings: mockSettings },
  );
}
