"""Generate the extension's small geometric app icon without external assets."""
import struct
import zlib
from pathlib import Path

root = Path(__file__).resolve().parent.parent / 'extension' / 'icons'
root.mkdir(exist_ok=True)
for size in (16, 32, 48, 128):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            u, v = (x + .5) / size, (y + .5) / size
            radius = .22
            dx, dy = max(.08 + radius - u, 0, u - (.92 - radius)), max(.08 + radius - v, 0, v - (.92 - radius))
            inside = dx * dx + dy * dy <= radius * radius and .08 <= u <= .92 and .08 <= v <= .92
            white = (.455 <= u <= .545 and .24 <= v <= .59) or (.43 <= v <= .67 and abs(u-.5) <= .67-v and abs(u-.5) >= .56-v) or (.29 <= u <= .71 and .74 <= v <= .80)
            rows.extend((255, 255, 255, 255) if white and inside else (max(24, int(45-15*v)), int(96+30*v), int(236-15*v), 255) if inside else (0, 0, 0, 0))
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')
    (root / f'{size}.png').write_bytes(png)
print('Generated 4 extension icons')
