import time, re, sys, json, subprocess
import numpy as np
from faster_whisper import WhisperModel
t=time.time(); model = WhisperModel("tiny.en", device="cpu", compute_type="int8"); print(f"model load {time.time()-t:.1f}s")
KW = re.compile(r"sponsor|brought to you|promo code|use code|code [a-z]+ for|% off|percent off|dot com|\.com|free trial|download the app|link in|check out|visit |sign up|offer", re.I)
def mmss(s): return f"{int(s//60)}:{int(s%60):02d}"
out = {}
for name in sys.argv[1:]:
    t=time.time()
    raw = subprocess.run(["ffmpeg","-v","error","-i",f"audio/{name}.mp3","-ac","1","-ar","16000","-f","s16le","-"],capture_output=True).stdout
    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32)/32768
    segs, info = model.transcribe(audio, language="en", vad_filter=False, beam_size=1)
    segs = [(s.start, s.end, s.text.strip()) for s in segs]
    el = time.time()-t
    print(f"\n#### {name}: {info.duration/60:.1f} min audio transcribed in {el:.0f}s  (x{info.duration/el:.1f} realtime), {len(segs)} segments")
    out[name] = segs
    hits = [s for s in segs if KW.search(s[2])]
    print(f"keyword-ish segments: {len(hits)}")
    for s in hits[:40]: print(f"  {mmss(s[0])}  {s[2][:150]}")
json.dump(out, open("tx.json","w"))
