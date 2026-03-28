use crate::error::Result;
use ort::session::{builder::SessionBuilder, Session};

// Hardware acceleration options. CPU is default and most reliable.
// GPU providers (CUDA, TensorRT, ROCm) offer 5-10x speedup but require specific hardware.
// All GPU providers automatically fall back to CPU if they fail.
//
// Note: CoreML currently fails with this model due to unsupported operations.
// WebGPU is experimental and may produce incorrect results.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ExecutionProvider {
    #[default]
    Cpu,
    #[cfg(feature = "qnn")]
    Qnn,
    #[cfg(feature = "cuda")]
    Cuda,
    #[cfg(feature = "tensorrt")]
    TensorRT,
    #[cfg(feature = "coreml")]
    CoreML,
    #[cfg(feature = "directml")]
    DirectML,
    #[cfg(feature = "rocm")]
    ROCm,
    #[cfg(feature = "openvino")]
    OpenVINO,
    #[cfg(feature = "openvino")]
    OpenVinoNpu,
    #[cfg(feature = "openvino")]
    OpenVinoGpu,
    #[cfg(feature = "webgpu")]
    WebGPU,
}

#[derive(Debug, Clone)]
pub struct ModelConfig {
    pub execution_provider: ExecutionProvider,
    pub intra_threads: usize,
    pub inter_threads: usize,
}

impl Default for ModelConfig {
    fn default() -> Self {
        Self {
            execution_provider: ExecutionProvider::default(),
            intra_threads: 4,
            inter_threads: 1,
        }
    }
}

impl ModelConfig {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_execution_provider(mut self, provider: ExecutionProvider) -> Self {
        self.execution_provider = provider;
        self
    }

    pub fn with_intra_threads(mut self, threads: usize) -> Self {
        self.intra_threads = threads;
        self
    }

    pub fn with_inter_threads(mut self, threads: usize) -> Self {
        self.inter_threads = threads;
        self
    }

    fn provider_cache_tag(&self) -> &'static str {
        match self.execution_provider {
            ExecutionProvider::Cpu => "cpu",
            #[cfg(feature = "qnn")]
            ExecutionProvider::Qnn => "qnn",
            #[cfg(feature = "cuda")]
            ExecutionProvider::Cuda => "cuda",
            #[cfg(feature = "tensorrt")]
            ExecutionProvider::TensorRT => "tensorrt",
            #[cfg(feature = "coreml")]
            ExecutionProvider::CoreML => "coreml",
            #[cfg(feature = "directml")]
            ExecutionProvider::DirectML => "directml",
            #[cfg(feature = "rocm")]
            ExecutionProvider::ROCm => "rocm",
            #[cfg(feature = "openvino")]
            ExecutionProvider::OpenVINO => "openvino",
            #[cfg(feature = "openvino")]
            ExecutionProvider::OpenVinoNpu => "openvino-npu",
            #[cfg(feature = "openvino")]
            ExecutionProvider::OpenVinoGpu => "openvino-gpu",
            #[cfg(feature = "webgpu")]
            ExecutionProvider::WebGPU => "webgpu",
        }
    }

    /// Load an ONNX session with ORT-format caching.
    ///
    /// - First call: runs Level3 optimization and saves the optimized model to
    ///   `{cache_dir}/{stem}_{provider}.opt.ort`.
    /// - Subsequent calls: if the `.opt.ort` file exists, loads it directly at
    ///   Level1 (skipping optimization — typically 5-10× faster).
    ///
    /// Pass `cache_dir = None` to disable caching (falls back to the plain
    /// `apply_to_session_builder` path).
    pub(crate) fn build_session(
        &self,
        model_path: &std::path::Path,
        cache_dir: Option<&std::path::Path>,
    ) -> Result<Session> {
        use ort::session::builder::GraphOptimizationLevel;

        let cache_path = cache_dir.map(|dir| {
            let stem = model_path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            dir.join(format!("{stem}_{}.opt.ort", self.provider_cache_tag()))
        });

        // ── Fast path: pre-optimized cache exists ────────────────────────── //
        if let Some(cache) = &cache_path {
            if cache.exists() {
                // Load with Level1 — the .ort file is already fully optimized,
                // so we skip the expensive Level3 graph optimization pass.
                // apply_to_session_builder forces Level3, so we build manually here.
                let builder = Session::builder()?
                    .with_optimization_level(GraphOptimizationLevel::Level1)?
                    .with_intra_threads(self.intra_threads)?
                    .with_inter_threads(self.inter_threads)?;
                let builder = self.apply_execution_provider(builder)?;
                return Ok(builder.commit_from_file(cache)?);
            }
        }

        // ── Slow path: Level3 optimization + save to cache ───────────────── //
        // `with_optimized_model_path` takes ownership even on failure, so we
        // branch explicitly to avoid losing the builder on the error path.
        let session = if let Some(cache) = cache_path {
            if let Some(parent) = cache.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let builder = self.apply_to_session_builder(Session::builder()?)?;
            match builder.with_optimized_model_path(&cache) {
                Ok(b) => b.commit_from_file(model_path)?,
                Err(_) => {
                    // Cache path rejected — load without saving.
                    self.apply_to_session_builder(Session::builder()?)?
                        .commit_from_file(model_path)?
                }
            }
        } else {
            self.apply_to_session_builder(Session::builder()?)?
                .commit_from_file(model_path)?
        };
        Ok(session)
    }

    /// Applies only the execution provider to an already-configured builder.
    /// Does NOT set optimization level or thread counts — call those separately.
    fn apply_execution_provider(&self, builder: SessionBuilder) -> Result<SessionBuilder> {
        #[cfg(any(
            feature = "cuda",
            feature = "tensorrt",
            feature = "coreml",
            feature = "directml",
            feature = "rocm",
            feature = "openvino",
            feature = "qnn",
            feature = "webgpu"
        ))]
        use ort::execution_providers::CPUExecutionProvider;

        let builder = match self.execution_provider {
            ExecutionProvider::Cpu => builder,

            #[cfg(feature = "qnn")]
            ExecutionProvider::Qnn => {
                use ort::execution_providers::qnn::{
                    QNNContextPriority, QNNExecutionProvider, QNNPerformanceMode,
                };

                #[cfg(target_os = "windows")]
                let qnn = QNNExecutionProvider::default()
                    .with_backend_path("QnnHtp.dll")
                    .with_performance_mode(QNNPerformanceMode::Balanced)
                    .with_context_priority(QNNContextPriority::NormalHigh)
                    .with_offload_graph_io_quantization(true)
                    .with_htp_weight_sharing(true);

                #[cfg(not(target_os = "windows"))]
                let qnn = QNNExecutionProvider::default()
                    .with_performance_mode(QNNPerformanceMode::Balanced)
                    .with_context_priority(QNNContextPriority::NormalHigh)
                    .with_offload_graph_io_quantization(true)
                    .with_htp_weight_sharing(true);

                builder.with_execution_providers([
                    qnn.build(),
                    CPUExecutionProvider::default().build().error_on_failure(),
                ])?
            }

            #[cfg(feature = "cuda")]
            ExecutionProvider::Cuda => builder.with_execution_providers([
                ort::execution_providers::CUDAExecutionProvider::default().build(),
                CPUExecutionProvider::default().build().error_on_failure(),
            ])?,

            #[cfg(feature = "tensorrt")]
            ExecutionProvider::TensorRT => builder.with_execution_providers([
                ort::execution_providers::TensorRTExecutionProvider::default().build(),
                CPUExecutionProvider::default().build().error_on_failure(),
            ])?,

            #[cfg(feature = "coreml")]
            ExecutionProvider::CoreML => {
                use ort::execution_providers::coreml::{
                    CoreMLComputeUnits, CoreMLExecutionProvider,
                };
                builder.with_execution_providers([
                    CoreMLExecutionProvider::default()
                        .with_compute_units(CoreMLComputeUnits::CPUAndGPU)
                        .build(),
                    CPUExecutionProvider::default().build().error_on_failure(),
                ])?
            }

            #[cfg(feature = "directml")]
            ExecutionProvider::DirectML => builder.with_execution_providers([
                ort::execution_providers::DirectMLExecutionProvider::default().build(),
                CPUExecutionProvider::default().build().error_on_failure(),
            ])?,

            #[cfg(feature = "rocm")]
            ExecutionProvider::ROCm => builder.with_execution_providers([
                ort::execution_providers::ROCmExecutionProvider::default().build(),
                CPUExecutionProvider::default().build().error_on_failure(),
            ])?,

            #[cfg(feature = "openvino")]
            ExecutionProvider::OpenVINO => builder.with_execution_providers([
                ort::execution_providers::OpenVINOExecutionProvider::default().build(),
                CPUExecutionProvider::default().build().error_on_failure(),
            ])?,

            #[cfg(feature = "openvino")]
            ExecutionProvider::OpenVinoNpu => builder.with_execution_providers([
                ort::execution_providers::OpenVINOExecutionProvider::default()
                    .with_device_type("NPU")
                    .with_qdq_optimizer(true)
                    .build(),
                CPUExecutionProvider::default().build().error_on_failure(),
            ])?,

            #[cfg(feature = "openvino")]
            ExecutionProvider::OpenVinoGpu => builder.with_execution_providers([
                ort::execution_providers::OpenVINOExecutionProvider::default()
                    .with_device_type("GPU")
                    .with_qdq_optimizer(true)
                    .build(),
                CPUExecutionProvider::default().build().error_on_failure(),
            ])?,

            #[cfg(feature = "webgpu")]
            ExecutionProvider::WebGPU => builder.with_execution_providers([
                ort::execution_providers::WebGPUExecutionProvider::default().build(),
                CPUExecutionProvider::default().build().error_on_failure(),
            ])?,
        };

        Ok(builder)
    }

    pub(crate) fn apply_to_session_builder(
        &self,
        builder: SessionBuilder,
    ) -> Result<SessionBuilder> {
        use ort::session::builder::GraphOptimizationLevel;

        let builder = builder
            .with_optimization_level(GraphOptimizationLevel::Level3)?
            .with_intra_threads(self.intra_threads)?
            .with_inter_threads(self.inter_threads)?;

        self.apply_execution_provider(builder)
    }
}
