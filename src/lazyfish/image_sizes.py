"""Read raster dimensions from headers without decoding image pixels."""
import struct


def _orientation(exif):
    if not exif.startswith(b'Exif\0\0'):
        return 1
    tiff = exif[6:]
    order = {b'II': '<', b'MM': '>'}.get(tiff[:2])
    if not order or struct.unpack_from(order + 'H', tiff, 2)[0] != 42:
        return 1
    offset = struct.unpack_from(order + 'I', tiff, 4)[0]
    count = struct.unpack_from(order + 'H', tiff, offset)[0]
    for index in range(count):
        entry = offset + 2 + index * 12
        tag, kind, length = struct.unpack_from(order + 'HHI', tiff, entry)
        if tag == 0x112 and kind == 3 and length == 1:
            return struct.unpack_from(order + 'H', tiff, entry + 8)[0]
    return 1


def image_dimensions(raw):
    """Return display width/height (including JPEG orientation), or zero if unknown.

    This is metadata extraction, not a replacement for the upload format/size checks.
    Truncated or unsupported headers retain a stable fallback in the client.
    """
    width = height = 0
    try:
        if raw.startswith(b'\x89PNG\r\n\x1a\n') and raw[12:16] == b'IHDR':
            width, height = struct.unpack_from('>II', raw, 16)
        elif raw.startswith(b'RIFF') and raw[8:12] == b'WEBP':
            offset = 12
            while offset + 8 <= len(raw):
                kind, size = raw[offset:offset + 4], struct.unpack_from('<I', raw, offset + 4)[0]
                data = raw[offset + 8:offset + 8 + min(size, 10)]
                if kind == b'VP8X' and len(data) >= 10:
                    width = 1 + int.from_bytes(data[4:7], 'little')
                    height = 1 + int.from_bytes(data[7:10], 'little')
                    break
                if kind == b'VP8 ' and data[3:6] == b'\x9d\x01\x2a':
                    width, height = (value & 0x3fff for value in struct.unpack_from('<HH', data, 6))
                    break
                if kind == b'VP8L' and data[:1] == b'\x2f':
                    bits = struct.unpack_from('<I', data, 1)[0]
                    width, height = (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1
                    break
                offset += 8 + size + size % 2
        elif raw.startswith(b'\xff\xd8'):
            offset, orientation = 2, 1
            while offset < len(raw):
                if raw[offset] != 0xff:
                    break
                while raw[offset] == 0xff:
                    offset += 1
                marker = raw[offset]
                offset += 1
                if marker in (0xda, 0xd9):  # Pixel data / end of image.
                    break
                if marker == 0x01 or 0xd0 <= marker <= 0xd8:
                    continue
                size = struct.unpack_from('>H', raw, offset)[0]
                if size < 2 or offset + size > len(raw):
                    break
                data = raw[offset + 2:offset + size]
                if marker == 0xe1:
                    try:
                        orientation = _orientation(data)
                    except (IndexError, struct.error):
                        pass  # Bad EXIF must not discard an otherwise usable size.
                if marker in (0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
                              0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf):
                    height, width = struct.unpack_from('>HH', data, 1)
                offset += size
            if orientation in (5, 6, 7, 8):
                width, height = height, width
    except (IndexError, struct.error):
        return 0, 0
    return (width, height) if 0 < width <= 0x1000000 and 0 < height <= 0x1000000 else (0, 0)

