"""
Gera as vozes naturais da Duda e do Bit com o Kokoro-82M (licença Apache 2.0).
Lê tools/vozes/linhas.json e grava audio/<chave>.mp3 + audio/index.json.
Só gera o que ainda não existe (texto mudou = chave nova = áudio novo).
"""
import json, os, subprocess, sys, tempfile
import numpy as np
import soundfile as sf
from kokoro import KPipeline

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AUDIO = os.path.join(ROOT, 'audio')
os.makedirs(AUDIO, exist_ok=True)
lines = json.load(open(os.path.join(ROOT, 'tools', 'vozes', 'linhas.json'), encoding='utf-8'))

# Duda: voz feminina brasileira. Bit: voz masculina, um tiquinho mais rápida e aguda (moeda animada).
VOICES = {
    'duda': {'voice': 'pf_dora', 'speed': 1.0, 'pitch': 1.0},
    'bit': {'voice': 'pm_alex', 'speed': 1.07, 'pitch': 1.06},
}
pipe = KPipeline(lang_code='p')
SR = 24000

def synth(text, who):
    cfg = VOICES[who]
    parts = [audio for _, _, audio in pipe(text, voice=cfg['voice'], speed=cfg['speed'])]
    audio = np.concatenate([np.asarray(p, dtype=np.float32) for p in parts])
    pad = np.zeros(int(SR * 0.12), dtype=np.float32)
    return np.concatenate([pad, audio, pad]), cfg

made = 0
for ln in lines:
    out = os.path.join(AUDIO, f"{ln['key']}.mp3")
    if os.path.exists(out):
        continue
    audio, cfg = synth(ln['text'], ln['who'])
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        sf.write(tmp.name, audio, SR)
        filters = ['highpass=f=70', 'loudnorm=I=-16:TP=-1.5:LRA=11']
        if cfg['pitch'] != 1.0:
            p = cfg['pitch']
            filters = [f'asetrate={int(SR * p)}', f'aresample={SR}', f'atempo={1 / p:.4f}'] + filters
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', tmp.name, '-af', ','.join(filters),
                        '-ac', '1', '-ar', str(SR), '-b:a', '48k', out], check=True)
        os.unlink(tmp.name)
    made += 1
    print(f"🎙️  {ln['who']}: {ln['text'][:70]}")

# índice: só as falas atuais (áudios antigos de textos que mudaram saem)
keys = [ln['key'] for ln in lines if os.path.exists(os.path.join(AUDIO, f"{ln['key']}.mp3"))]
for f in os.listdir(AUDIO):
    if f.endswith('.mp3') and f[:-4] not in keys:
        os.remove(os.path.join(AUDIO, f))
json.dump(keys, open(os.path.join(AUDIO, 'index.json'), 'w'), indent=0)
print(f"Pronto: {made} áudio(s) novo(s), {len(keys)} no total.")
