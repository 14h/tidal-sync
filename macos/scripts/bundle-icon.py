"""Write modern PNG-backed ICNS entries from the generated iconset."""
from pathlib import Path
import struct
import sys

folder = Path(sys.argv[1])
entries = [('icp4', '16x16'), ('icp5', '32x32'), ('icp6', '32x32@2x'),
           ('ic07', '128x128'), ('ic08', '256x256'), ('ic09', '512x512'), ('ic10', '512x512@2x')]
chunks = []
for kind, name in entries:
    png = (folder / f'icon_{name}.png').read_bytes()
    chunks.append(kind.encode('ascii') + struct.pack('>I', len(png) + 8) + png)
payload = b''.join(chunks)
Path(sys.argv[2]).write_bytes(b'icns' + struct.pack('>I', len(payload) + 8) + payload)
