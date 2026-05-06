use clap::Parser;

#[derive(Parser, Debug, Clone, Default)]
#[command(name = "vocalype", about = "vocalype - Speech to Text")]
#[command(allow_external_subcommands = true, ignore_errors = true)]
pub struct CliArgs {
    /// Start with the main window hidden
    #[arg(long)]
    pub start_hidden: bool,

    /// Disable the system tray icon
    #[arg(long)]
    pub no_tray: bool,

    /// Toggle transcription on/off (sent to running instance)
    #[arg(long)]
    pub toggle_transcription: bool,

    /// Toggle transcription with post-processing on/off (sent to running instance)
    #[arg(long)]
    pub toggle_post_process: bool,

    /// Cancel the current operation (sent to running instance)
    #[arg(long)]
    pub cancel: bool,

    /// Enable debug mode with verbose logging
    #[arg(long)]
    pub debug: bool,

    /// Run the local post-processing fidelity benchmark and exit
    #[arg(long, hide = true)]
    pub postprocess_benchmark: bool,

    /// Optional output path for the post-processing benchmark report
    #[arg(long, hide = true)]
    pub postprocess_benchmark_output: Option<String>,

    /// Run a one-off post-processing probe for a history entry id and exit
    #[arg(long, hide = true)]
    pub postprocess_probe_history_id: Option<i64>,

    /// Optional output path for the post-processing probe report
    #[arg(long, hide = true)]
    pub postprocess_probe_output: Option<String>,
}
