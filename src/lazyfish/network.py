"""Native interface discovery and bind-address helpers (stdlib only)."""

from __future__ import annotations

import ctypes
import ipaddress
import socket
import sys


# Display only: keep VPN/physical interfaces, hide bridges and wireless direct.
_CONTAINER_PREFIXES = (
    b"docker", b"br-", b"virbr", b"veth", b"cni", b"flannel", b"podman",
    b"cali", b"kube-ipvs", b"bridge", b"awdl", b"llw",
)
_IFF_UP = 0x1


class _Ifaddrs(ctypes.Structure):
    pass


_Ifaddrs._fields_ = [
    ("next", ctypes.POINTER(_Ifaddrs)), ("name", ctypes.c_char_p),
    ("flags", ctypes.c_uint), ("addr", ctypes.c_void_p),
    ("netmask", ctypes.c_void_p), ("destination", ctypes.c_void_p),
    ("data", ctypes.c_void_p),
]
_libc = ctypes.CDLL(None, use_errno=True)
_libc.getifaddrs.argtypes = [ctypes.POINTER(ctypes.POINTER(_Ifaddrs))]
_libc.freeifaddrs.argtypes = [ctypes.POINTER(_Ifaddrs)]


_PRIVATE_NETWORKS = tuple(
    ipaddress.IPv4Network(value) for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
)


def private_ipv4(value: str) -> bool:
    try:
        address = ipaddress.IPv4Address(value)
    except ipaddress.AddressValueError:
        return False
    return any(address in network for network in _PRIVATE_NETWORKS)


def bindable_ipv4(value: object) -> bool:
    """Accept 0.0.0.0 or a unicast IPv4 address, including public and loopback."""
    if not isinstance(value, str):
        return False
    if value == "0.0.0.0":
        return True
    try:
        address = ipaddress.IPv4Address(value)
    except ipaddress.AddressValueError:
        return False
    return not address.is_multicast and address != ipaddress.IPv4Address("255.255.255.255")


def local_ipv4s(*, for_display: bool = False) -> set[str]:
    """Read UP IPv4 interfaces, including aliases, without DNS or subprocesses.

    sockaddr starts with sa_len/sa_family on Darwin, sa_family_t on Linux;
    sockaddr_in's address occupies bytes 4..7 on both. Discovery failures
    fail closed. Display filtering never changes the Host allow-list.
    """
    head = ctypes.POINTER(_Ifaddrs)()
    try:
        if _libc.getifaddrs(ctypes.byref(head)) != 0:
            return set()
        addresses = set()
        current = head
        while current:
            item = current.contents
            current = item.next
            if not item.addr or not item.flags & _IFF_UP:
                continue
            header = ctypes.string_at(item.addr, 2)
            family = header[1] if sys.platform == "darwin" else int.from_bytes(header, sys.byteorder)
            if family != socket.AF_INET:
                continue
            if for_display and (item.name or b"").startswith(_CONTAINER_PREFIXES):
                continue
            addresses.add(socket.inet_ntoa(ctypes.string_at(item.addr + 4, 4)))
        return addresses
    except OSError:
        return set()
    finally:
        if head:
            _libc.freeifaddrs(head)


def request_host(bind_host: str) -> str:
    """Wildcard binds are not destinations for authenticated lifecycle requests."""
    return "127.0.0.1" if bind_host == "0.0.0.0" else bind_host


def access_hosts(bind_host: str) -> list[str]:
    if bind_host != "0.0.0.0":
        return [bind_host]
    displayed = {host for host in local_ipv4s(for_display=True) if host != "127.0.0.1"}
    return ["127.0.0.1", *sorted(displayed)]
