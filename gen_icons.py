#!/usr/bin/env python3
"""Generate simple PNG icons for the extension using only stdlib."""
import struct, zlib

def make_png(size, bg=(12,12,14), fg=(198,241,53)):
    """Generate a minimal PNG with the VerifyAI V logo."""
    w = h = size
    # RGBA pixels
    pixels = []
    cx, cy = w // 2, h // 2
    r = w * 0.35

    for y in range(h):
        row = []
        for x in range(w):
            dx, dy = x - cx, y - cy
            dist = (dx*dx + dy*dy) ** 0.5
            # Circle background
            if dist <= r:
                # Draw a simple "V" shape
                # Normalize coords within circle
                nx = dx / r
                ny = dy / r
                # Left arm of V: goes from top-left to center-bottom
                # Right arm of V: goes from top-right to center-bottom
                in_v = False
                # Left bar: nx in range and slope
                if -0.55 < nx < -0.05:
                    expected_y = 0.7 * nx + 0.38
                    if abs(ny - expected_y) < 0.13:
                        in_v = True
                # Right bar
                if 0.05 < nx < 0.55:
                    expected_y = -0.7 * nx + 0.38
                    if abs(ny - expected_y) < 0.13:
                        in_v = True
                if in_v:
                    row += list(fg) + [255]
                else:
                    row += list(bg) + [255]
            else:
                row += [0, 0, 0, 0]  # transparent
        pixels.append(bytes(row))

    def png_chunk(name, data):
        crc = zlib.crc32(name + data) & 0xffffffff
        return struct.pack(">I", len(data)) + name + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    raw = b"".join(b"\x00" + row for row in pixels)
    idat = zlib.compress(raw, 9)

    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", ihdr)
        + png_chunk(b"IDAT", idat)
        + png_chunk(b"IEND", b"")
    )

import os
os.makedirs("icons", exist_ok=True)
for size in (16, 48, 128):
    with open(f"icons/icon{size}.png", "wb") as f:
        f.write(make_png(size))
    print(f"Generated icons/icon{size}.png")
print("Done!")
