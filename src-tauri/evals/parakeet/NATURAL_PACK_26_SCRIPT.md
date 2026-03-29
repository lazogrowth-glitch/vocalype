# Natural Pack 26 Script

Record the files in this exact order.

Use these exact filenames:

1. `natural_chat_en_001.wav`
Text:
`hey I just wanted to check if you saw my last message because I think we still need to fix that issue before the release`

2. `natural_chat_en_002.wav`
Text:
`yeah so I was thinking maybe we should push that change tomorrow instead of tonight just to be safe`

3. `free_form_en_001.wav`
Text:
`okay let me explain this properly the app works most of the time but once in a while the transcript skips a few words near the end and that is what I want to fix first`

4. `free_form_en_002.wav`
Text:
`I am not reading this like a robot I am trying to speak naturally and leave little hesitations in the sentence the way I normally would in real life`

5. `accent_en_001.wav`
Text:
`today I want to test how well the model handles my accent when I am speaking at a regular pace with everyday words`

6. `accent_en_002.wav`
Text:
`this sample is here to check whether the system still keeps the words clean when the pronunciation is less standard`

7. `dirty_noise_en_001.wav`
Text:
`I am recording this with more background noise on purpose to see whether the transcript stays usable in a messy room`

8. `dirty_noise_en_002.wav`
Text:
`there is some real noise around me right now and I want to know if the model still catches the main sentence correctly`

9. `very_low_volume_en_001.wav`
Text:
`I am speaking very softly now and I want to see if the transcript still keeps the right words without turning strange`

10. `very_low_volume_en_002.wav`
Text:
`this is another quiet sample because I want to know exactly where the model starts failing when the microphone input is too weak`

11. `weird_pauses_en_001.wav`
Text:
`I want to test a sentence where I pause in odd places because some people do not speak in a smooth continuous rhythm`

12. `weird_pauses_en_002.wav`
Text:
`this recording has little stops and restarts in the middle of the thought so we can see if chunking still behaves well`

13. `conversation_en_001.wav`
Text:
`no I mean not that button the other one on the left yeah that one okay now try it again`

14. `conversation_en_002.wav`
Text:
`wait hold on I think I got it now can you send me the latest version before I test it again`

15. `interruption_en_001.wav`
Text:
`I was going to say we should probably ship this on Friday actually wait no maybe Monday is safer`

16. `interruption_en_002.wav`
Text:
`send the report to the team no sorry send it to the product channel first and then forward it to the team`

17. `cheap_mic_en_001.wav`
Text:
`this sample is meant to simulate a cheap laptop microphone where the signal is less clean and a bit more harsh`

18. `cheap_mic_en_002.wav`
Text:
`I want to know whether the transcript still comes out clean when the hardware quality is average at best`

19. `code_switch_en_001.wav`
Text:
`I am mostly speaking English here but I might drop a small French word like bonjour just to see what happens`

20. `code_switch_en_002.wav`
Text:
`this is still an English sample but I am adding a couple of foreign sounding words to make the recognition work harder`

21. `messy_thought_en_001.wav`
Text:
`okay so the thing is I kind of know what I want to say but I am figuring it out while I talk and that is more realistic than reading`

22. `messy_thought_en_002.wav`
Text:
`I am changing direction a little inside the sentence because I want this test to feel like actual speech and not like a script`

23. `far_mic_en_001.wav`
Text:
`I am standing a little farther from the microphone now so the app can be tested in a less ideal setup`

24. `far_mic_en_002.wav`
Text:
`this one should tell us how quickly the quality drops once the microphone is no longer close to the speaker`

25. `overlap_speech_en_001.wav`
Text:
`I am speaking with a bit of urgency and not much separation between ideas so the chunk boundaries get a harder workout`

26. `overlap_speech_en_002.wav`
Text:
`this sample should stress the handoff between chunks because I keep going without much breathing room`

## Quick Recording Rules

- Speak naturally, not like a robot.
- Keep the exact wording.
- Leave a little silence at the start and end if possible.
- For `dirty_noise`, use real noise.
- For `very_low_volume`, speak softly but stay understandable.
- For `weird_pauses`, actually pause in slightly awkward spots.
- For `far_mic`, stand farther from the microphone.
