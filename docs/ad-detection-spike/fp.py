import subprocess, time, sys, itertools
import numpy as np
from scipy import signal
from scipy.ndimage import maximum_filter

FS, NPERSEG, HOP = 11025, 1024, 512
FRAME_S = HOP / FS

def decode(path):
    t = time.time()
    p = subprocess.run(["ffmpeg","-v","error","-i",path,"-ac","1","-ar",str(FS),"-f","s16le","-"],capture_output=True)
    x = np.frombuffer(p.stdout, dtype=np.int16).astype(np.float32) / 32768
    return x, time.time() - t

def fingerprint(x):
    t = time.time()
    f, tt, S = signal.spectrogram(x, fs=FS, nperseg=NPERSEG, noverlap=NPERSEG-HOP, mode="magnitude")
    S = np.log1p(S * 100)
    S = S[:256]                      # up to ~2.7 kHz: where speech/music energy is
    mx = maximum_filter(S, size=(21, 21))
    peaks = (S == mx) & (S > np.percentile(S, 90))
    fi, ti = np.nonzero(peaks)
    order = np.argsort(ti, kind="stable")
    fi, ti = fi[order], ti[order]
    hashes, times = [], []
    n = len(ti)
    for i in range(n):
        j = i + 1
        cnt = 0
        while j < n and ti[j] - ti[i] <= 40 and cnt < 6:
            dt = ti[j] - ti[i]
            if dt >= 1:
                hashes.append((int(fi[i]) << 20) | (int(fi[j]) << 8) | int(dt))
                times.append(int(ti[i]))
                cnt += 1
            j += 1
    return np.array(hashes, dtype=np.int64), np.array(times, dtype=np.int32), time.time() - t

def index(h, t):
    d = {}
    for hh, tt in zip(h.tolist(), t.tolist()):
        d.setdefault(hh, []).append(tt)
    return d

def match(ia, ib, min_votes=20, min_len_s=5.0):
    votes = []                       # (diff, tA)
    for hh, ta_list in ia.items():
        tb_list = ib.get(hh)
        if tb_list is None or len(ta_list) > 8 or len(tb_list) > 8: continue
        for ta in ta_list:
            for tb in tb_list:
                votes.append((ta - tb, ta))
    if not votes: return []
    v = np.array(votes)
    diffs = v[:, 0]
    lo, hi = diffs.min(), diffs.max()
    counts = np.bincount(diffs - lo)
    segs = []
    used = np.zeros(len(counts), bool)
    for d in np.argsort(-counts):
        if counts[d] < min_votes: break
        if used[max(d-2,0):d+3].any(): continue
        used[max(d-2,0):d+3] = True
        sel = v[(diffs >= d + lo - 1) & (diffs <= d + lo + 1), 1]
        sel = np.sort(sel)
        start = sel[0]; prev = sel[0]; cnt = 1
        for s in list(sel[1:]) + [None]:
            if s is None or s - prev > 90:      # gap > ~4 s ends a run
                length = (prev - start) * FRAME_S
                if length >= min_len_s and cnt / max(length, 1) >= 2:
                    segs.append((start*FRAME_S, prev*FRAME_S, (start-(d+lo))*FRAME_S, (prev-(d+lo))*FRAME_S, cnt))
                if s is not None: start = s; cnt = 0
            if s is not None: cnt += 1; prev = s
    return sorted(segs)

def mmss(s): return f"{int(s//60)}:{int(s%60):02d}"

if __name__ == "__main__":
    names = ["rotten_0","rotten_1","rotten_2","shxts_0","shxts_1","shxts_2"]
    idx = {}
    for n in names:
        x, dt = decode(f"audio/{n}.mp3")
        h, t, ft = fingerprint(x)
        idx[n] = index(h, t)
        print(f"{n}: {len(x)/FS/60:.1f} min audio, decode {dt:.1f}s, fingerprint {ft:.1f}s, {len(h)} hashes")
    pairs = [("rotten_0","rotten_1"),("rotten_0","rotten_2"),("rotten_1","rotten_2"),
             ("shxts_0","shxts_1"),("shxts_0","shxts_2"),("shxts_1","shxts_2"),
             ("rotten_0","shxts_0"),("rotten_1","shxts_1"),("rotten_2","shxts_2")]   # last three: cross-show control
    for a, b in pairs:
        t = time.time()
        segs = match(idx[a], idx[b])
        tag = "  (CONTROL: different shows)" if a.split("_")[0] != b.split("_")[0] else ""
        print(f"\n{a} vs {b}{tag}: {len(segs)} repeated segment(s)  [{time.time()-t:.1f}s]")
        for s in segs:
            print(f"   {a} {mmss(s[0])}-{mmss(s[1])}  ==  {b} {mmss(s[2])}-{mmss(s[3])}   ({s[1]-s[0]:.0f}s, {s[4]} votes)")
