"""Offline golden fixture from the user's UMA-8 Python; needs numpy only, never a server dependency.
Run: python generate.py /path/to/user-prototype.py
"""
import ast, hashlib, json, sys
from pathlib import Path
import numpy as np
source=Path(sys.argv[1]);root=Path(__file__).parent
wanted={'geometry','steering','design_weights','LiveProcessor'}
tree=ast.parse(source.read_text());tree.body=[node for node in tree.body if isinstance(node,(ast.FunctionDef,ast.ClassDef)) and node.name in wanted]
space={'np':np,'SR':48000,'FFT':1024,'HOP':256,'SOUND_SPEED':343.,'METHODS':('mic5','average','das','lcmv'),'hann':lambda n,sym=False:0.5-0.5*np.cos(2*np.pi*np.arange(n)/n)}
exec(compile(tree,str(source),'exec'),space)
weights=space['design_weights']();processor=space['LiveProcessor'](weights)
rng=np.random.default_rng(20261102);samples=rng.normal(0,.05,(8192,8)).astype('<f4')
expected=np.concatenate([processor.process(samples[i:i+256])['lcmv'] for i in range(0,len(samples),256)])
# Browser emits the completed hop beginning at the next sample, adding one hop to Python's block convention.
expected=np.concatenate([np.zeros(256,dtype='<f4'),expected[:-256]]).astype('<f4')
for name,data in [('input.f32',samples),('output.f32',expected),('weights.f64',weights['lcmv'].view(np.float64).astype('<f8'))]: data.tofile(root/name)
(root/'provenance.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'sampleRate':48000,'frames':len(samples),'seed':20261102,'fft':1024,'hop':256,'radiusMm':44,'loading':.03,'extraSchedulingFrames':256,'binaryLayout':'little-endian; input frame-major8channels; weights bin-major7complex pairs','files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in root.glob('*.f*')}},indent=2)+'\n')
