use parakeet_rs::ParakeetEOU;
use std::path::PathBuf;
use std::time::Instant;

const SAMPLE_RATE: usize = 16_000;
const CHUNK_SAMPLES: usize = 2_560;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let model_dir = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let appdata = std::env::var("APPDATA").unwrap_or_default();
            PathBuf::from(appdata)
                .join("com.vocalype.desktop")
                .join("models")
                .join("parakeet-eou")
        });

    println!("Loading Parakeet EOU model from {}", model_dir.display());
    let load_started = Instant::now();
    let mut model = ParakeetEOU::from_pretrained(&model_dir, None)?;
    println!("Loaded in {}ms", load_started.elapsed().as_millis());

    let inference_started = Instant::now();
    let silence = vec![0.0_f32; SAMPLE_RATE];
    let mut emitted = String::new();
    for chunk in silence.chunks(CHUNK_SAMPLES) {
        let mut frame = chunk.to_vec();
        frame.resize(CHUNK_SAMPLES, 0.0);
        emitted.push_str(&model.transcribe(&frame, true)?);
    }

    println!(
        "Silence smoke inference finished in {}ms; emitted={:?}",
        inference_started.elapsed().as_millis(),
        emitted.trim()
    );
    Ok(())
}
