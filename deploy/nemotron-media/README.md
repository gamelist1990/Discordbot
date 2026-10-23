# Nemotron multimodal gateway

Runtime flow: HomePC EndPoint API (9000) → A8 inference gateway (8080) → HomePC media preprocessor (18671) → LFM vision model (18670) → A8 nemotron-bolt.

The NVIDIA model runs on the A8 Radeon GPU using Vulkan. NVIDIA identifies the model vendor, not installed GPU hardware. Images are described by the HomePC LFM model. GIFs and videos are sampled at six timestamps; captions retain ordering and timestamps. This is visual frame analysis, not audio transcription or exhaustive video analysis.

HomePC requires Python 3, ffmpeg/ffprobe, the running lfm-vision service, and the included lfm-media user service. The service binds the HomePC Tailscale IP. Media input is limited to 32 MiB each and 12 inputs per request. Failed media analysis returns an error rather than silently treating it as text.

A8 llama-service.py must recognize image_url, input_image, video_url and input_video parts and send the original JSON body to http://100.83.127.8:18671/preprocess before activating nemotron-bolt. The returned request contains text observations in place of media parts. This change is already applied to the running A8 gateway; restarting only the Bot does not install that gateway change elsewhere.

Bot configuration automatically migrates qwopus-coder references to nemotron-bolt. Existing Bot API credentials are retained locally and are not included here.

On Bot startup, database initialization physically removes retired user profile records and chat-ai-channel/user-memory.json. Daily records and explicitly created server memos remain. Staff AI history reset clears its statistics, stored conversation dataset, conversation review history, daily summaries and learned server style; custom memos remain available on the Staff page.

Validation: TypeScript check and Vite build passed; 45 focused tests passed. Live HomePC API requests returned nemotron-bolt for PNG, GIF and MP4, including /v1/responses for MP4. Measured sample latencies were 14.31 s, 51.63 s and 43.06 s respectively. Visual captions can omit or misidentify details; six sampled frames can miss short events. The UI smoke test checks DOM content, runtime errors and horizontal layout, not visual recognition quality.

Production Discord Bot deployment/restart and deletion of its existing real data remain pending access to that host. HomePC and A8 services are updated and running.
