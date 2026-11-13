"""Linux interface discovery and explicit RFC1918 address policy (stdlib only)."""

from __future__ import annotations

import array
import fcntl
import ipaddress
import socket
import struct


# Common Linux container/bridge names; VPN and physical interfaces remain visible.
_CONTAINER_PREFIXES = (
    b"docker", b"br-", b"virbr", b"veth", b"cni", b"flannel", b"podman", b"cali", b"kube-ipvs",
)
_SIOCGIFCONF = 0x8912
_SIOCGIFFLAGS = 0x8913
_IFF_UP = 0x1
_PRIVATE_NETWORKS = tuple(
    ipaddress.IPv4Network(value) for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
)


def private_ipv4(value: str) -> bool:
    try:
        address = ipaddress.IPv4Address(value)
    except ipaddress.AddressValueError:
        return False
    return any(address in network for network in _PRIVATE_NETWORKS)


def local_ipv4s(*, for_display: bool = False) -> set[str]:
    """Read all IPv4 interface records, including aliases; fail closed on errors.

    SIOCGIFCONF returns Linux struct ifreq records (40 bytes on 64-bit, 32 on
    32-bit). Grow the buffer until there is room for at least one more record.
    Only interfaces marked UP are included. For the startup banner, omit common
    container/bridge interface names; this is a display heuristic, not an access
    control rule. Host validation still includes their addresses.
    No DNS lookup, external command, or outbound connection is needed.
    """
    stride = 40 if struct.calcsize("P") == 8 else 32
    size = stride * 32
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            while True:
                buffer = array.array("B", bytes(size))
                result = fcntl.ioctl(sock.fileno(), _SIOCGIFCONF,
                                     struct.pack("iP", size, buffer.buffer_info()[0]))
                length = struct.unpack("iP", result)[0]
                if length < 0 or length > size:
                    return set()
                if size - length >= stride:
                    break
                size *= 2
                if size > 1024 * 1024:
                    return set()
            records = buffer.tobytes()
            addresses = set()
            for offset in range(0, length - stride + 1, stride):
                if struct.unpack_from("H", records, offset + 16)[0] != socket.AF_INET:
                    continue
                name = records[offset:offset + 16].split(b"\0", 1)[0]
                flags = fcntl.ioctl(sock.fileno(), _SIOCGIFFLAGS, struct.pack("16sH14x", name, 0))
                if not struct.unpack_from("H", flags, 16)[0] & _IFF_UP:
                    continue
                if for_display and name.startswith(_CONTAINER_PREFIXES):
                    continue
                addresses.add(socket.inet_ntoa(records[offset + 20:offset + 24]))
            return addresses
    except OSError:
        return set()


def request_host(bind_host: str) -> str:
    """Wildcard binds are not destinations for authenticated lifecycle requests."""
    return "127.0.0.1" if bind_host == "0.0.0.0" else bind_host


def access_hosts(bind_host: str) -> list[str]:
    if bind_host != "0.0.0.0":
        return [bind_host]
    return ["127.0.0.1", *sorted(host for host in local_ipv4s(for_display=True) if private_ipv4(host))]
