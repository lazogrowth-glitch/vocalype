import { describe, it, expect, vi, beforeEach } from "vitest";
import { useModelStore } from "./modelStore";

vi.mock("@/bindings", () => ({
  commands: {
    getAvailableModels: vi.fn(),
    getCurrentModel: vi.fn(),
    hasAnyModelsAvailable: vi.fn(),
    setActiveModel: vi.fn(),
    downloadModel: vi.fn(),
    cancelDownload: vi.fn(),
    deleteModel: vi.fn(),
  },
}));

import { commands } from "@/bindings";
const mockCommands = commands as unknown as Record<string, ReturnType<typeof vi.fn>>;

const resetStore = () =>
  useModelStore.setState({
    models: [],
    currentModel: "",
    downloadingModels: {},
    extractingModels: {},
    downloadProgress: {},
    downloadStats: {},
    loading: true,
    error: null,
    hasAnyModels: false,
    isFirstRun: false,
    initialized: false,
  });

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  mockCommands.getAvailableModels.mockResolvedValue({ status: "ok", data: [] });
  mockCommands.getCurrentModel.mockResolvedValue({ status: "ok", data: "" });
});

describe("modelStore — initial state", () => {
  it("has empty models list", () => {
    expect(useModelStore.getState().models).toEqual([]);
  });

  it("has loading=true", () => {
    expect(useModelStore.getState().loading).toBe(true);
  });

  it("has empty currentModel", () => {
    expect(useModelStore.getState().currentModel).toBe("");
  });

  it("has null error", () => {
    expect(useModelStore.getState().error).toBeNull();
  });
});

describe("modelStore — internal setters", () => {
  it("setModels updates models", () => {
    useModelStore.getState().setModels([{ id: "m1" }] as never);
    expect(useModelStore.getState().models[0].id).toBe("m1");
  });

  it("setCurrentModel updates currentModel", () => {
    useModelStore.getState().setCurrentModel("m1");
    expect(useModelStore.getState().currentModel).toBe("m1");
  });

  it("setError updates error", () => {
    useModelStore.getState().setError("oops");
    expect(useModelStore.getState().error).toBe("oops");
  });

  it("setLoading updates loading", () => {
    useModelStore.getState().setLoading(false);
    expect(useModelStore.getState().loading).toBe(false);
  });
});

describe("modelStore — loadModels", () => {
  it("sets models on success", async () => {
    mockCommands.getAvailableModels.mockResolvedValue({
      status: "ok",
      data: [{ id: "m1", is_downloading: false }],
    });
    await useModelStore.getState().loadModels();
    expect(useModelStore.getState().models[0].id).toBe("m1");
    expect(useModelStore.getState().error).toBeNull();
    expect(useModelStore.getState().loading).toBe(false);
  });

  it("sets error on failure result", async () => {
    mockCommands.getAvailableModels.mockResolvedValue({ status: "error", error: "backend error" });
    await useModelStore.getState().loadModels();
    expect(useModelStore.getState().error).toContain("backend error");
    expect(useModelStore.getState().loading).toBe(false);
  });

  it("sets error on thrown exception", async () => {
    mockCommands.getAvailableModels.mockRejectedValue(new Error("network"));
    await useModelStore.getState().loadModels();
    expect(useModelStore.getState().error).toContain("network");
    expect(useModelStore.getState().loading).toBe(false);
  });
});

describe("modelStore — loadCurrentModel", () => {
  it("sets currentModel on success", async () => {
    mockCommands.getCurrentModel.mockResolvedValue({ status: "ok", data: "whisper-small" });
    await useModelStore.getState().loadCurrentModel();
    expect(useModelStore.getState().currentModel).toBe("whisper-small");
  });
});

describe("modelStore — checkFirstRun", () => {
  it("sets isFirstRun=true when no models available", async () => {
    mockCommands.hasAnyModelsAvailable.mockResolvedValue({ status: "ok", data: false });
    const result = await useModelStore.getState().checkFirstRun();
    expect(result).toBe(true);
    expect(useModelStore.getState().isFirstRun).toBe(true);
    expect(useModelStore.getState().hasAnyModels).toBe(false);
  });

  it("sets isFirstRun=false when models exist", async () => {
    mockCommands.hasAnyModelsAvailable.mockResolvedValue({ status: "ok", data: true });
    const result = await useModelStore.getState().checkFirstRun();
    expect(result).toBe(false);
    expect(useModelStore.getState().isFirstRun).toBe(false);
    expect(useModelStore.getState().hasAnyModels).toBe(true);
  });

  it("returns false on exception", async () => {
    mockCommands.hasAnyModelsAvailable.mockRejectedValue(new Error("fail"));
    const result = await useModelStore.getState().checkFirstRun();
    expect(result).toBe(false);
  });
});

describe("modelStore — selectModel", () => {
  it("updates currentModel on success", async () => {
    mockCommands.setActiveModel.mockResolvedValue({ status: "ok", data: null });
    const result = await useModelStore.getState().selectModel("m1");
    expect(result).toBe(true);
    expect(useModelStore.getState().currentModel).toBe("m1");
    expect(useModelStore.getState().isFirstRun).toBe(false);
    expect(useModelStore.getState().hasAnyModels).toBe(true);
  });

  it("sets error and returns false on failure", async () => {
    mockCommands.setActiveModel.mockResolvedValue({ status: "error", error: "not found" });
    const result = await useModelStore.getState().selectModel("bad");
    expect(result).toBe(false);
    expect(useModelStore.getState().error).toContain("not found");
  });
});

describe("modelStore — downloadModel", () => {
  it("marks model as downloading on success", async () => {
    mockCommands.downloadModel.mockResolvedValue({ status: "ok", data: null });
    const result = await useModelStore.getState().downloadModel("m1");
    expect(result).toBe(true);
    expect(useModelStore.getState().isModelDownloading("m1")).toBe(true);
  });

  it("clears downloading state and sets error on failure", async () => {
    mockCommands.downloadModel.mockResolvedValue({ status: "error", error: "server error" });
    const result = await useModelStore.getState().downloadModel("m1");
    expect(result).toBe(false);
    expect(useModelStore.getState().isModelDownloading("m1")).toBe(false);
    expect(useModelStore.getState().error).toContain("server error");
  });
});

describe("modelStore — cancelDownload", () => {
  it("clears download state on success", async () => {
    useModelStore.setState({
      downloadingModels: { m1: true },
      downloadProgress: {
        m1: { model_id: "m1", downloaded: 50, total: 100, percentage: 50 },
      },
    });
    mockCommands.cancelDownload.mockResolvedValue({ status: "ok", data: null });
    const result = await useModelStore.getState().cancelDownload("m1");
    expect(result).toBe(true);
    expect(useModelStore.getState().isModelDownloading("m1")).toBe(false);
    expect(useModelStore.getState().getDownloadProgress("m1")).toBeUndefined();
  });
});

describe("modelStore — selectors", () => {
  it("getModelInfo returns model by id", () => {
    useModelStore.setState({ models: [{ id: "m1", name: "Model 1" }] as never });
    expect(useModelStore.getState().getModelInfo("m1")?.id).toBe("m1");
    expect(useModelStore.getState().getModelInfo("missing")).toBeUndefined();
  });

  it("isModelDownloading returns correct boolean", () => {
    useModelStore.setState({ downloadingModels: { m1: true } });
    expect(useModelStore.getState().isModelDownloading("m1")).toBe(true);
    expect(useModelStore.getState().isModelDownloading("m2")).toBe(false);
  });

  it("isModelExtracting returns correct boolean", () => {
    useModelStore.setState({ extractingModels: { m1: true } });
    expect(useModelStore.getState().isModelExtracting("m1")).toBe(true);
    expect(useModelStore.getState().isModelExtracting("m2")).toBe(false);
  });

  it("getDownloadProgress returns progress for known model", () => {
    const progress = { model_id: "m1", downloaded: 50, total: 100, percentage: 50 };
    useModelStore.setState({ downloadProgress: { m1: progress } });
    expect(useModelStore.getState().getDownloadProgress("m1")).toEqual(progress);
    expect(useModelStore.getState().getDownloadProgress("m2")).toBeUndefined();
  });
});
