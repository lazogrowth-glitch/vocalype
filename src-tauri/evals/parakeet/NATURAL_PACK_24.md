# Natural Pack 24

This pack is meant to stress `Parakeet V3` in more realistic voice conditions
than the clean English prompt set.

Manifest:
- `dataset_manifest_natural_24.json`

Audio folder:
- `audio/`

## Goal

Exercise the model on:
- more natural wording
- less scripted rhythm
- accents
- dirtier noise
- very soft voice
- odd pauses
- self-corrections
- conversational speech
- chunk-boundary stress

## How To Record

For every sample:
1. Keep the exact `sample_id` as the filename.
2. Record to WAV `16 kHz` mono if possible.
3. Say the reference sentence naturally, not like a robot.
4. For accent/noise/low-volume scenarios, actually perform the condition.

## Scenario Notes

`natural_chat_en`
- relaxed tone
- casual everyday delivery

`free_form_en`
- longer, freer delivery
- light hesitations are okay

`accent_en`
- speak with your natural accent
- do not over-correct pronunciation

`dirty_noise_en`
- real room noise, keyboard, fan, street, TV, etc.

`very_low_volume_en`
- speak very softly but still intelligibly

`weird_pauses_en`
- insert slightly awkward pauses

`conversation_en`
- fast back-and-forth style

`interruption_en`
- self-correct in the middle of the sentence

`cheap_mic_en`
- laptop mic or weaker hardware if possible

`code_switch_en`
- mostly English, tiny amount of foreign wording

`messy_thought_en`
- think while speaking
- more realistic than reading

`far_mic_en`
- stand a bit farther from the microphone

`overlap_speech_en`
- speak with little separation between clauses

## Run

```powershell
cd src-tauri
cargo run --example parakeet_pipeline_eval -- "C:\Users\ziani\AppData\Roaming\com.vocalype.desktop\models\parakeet-tdt-0.6b-v3-int8" .\evals\parakeet\dataset_manifest_natural_24.json parakeet-tdt-0.6b-v3-multilingual .\evals\parakeet\reports\natural-24-pipeline.json
```
