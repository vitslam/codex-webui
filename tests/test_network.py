import ctypes
import socket
import struct
import unittest
from unittest.mock import patch

from lazyfish.network import access_hosts, local_ipv4s, private_ipv4, request_host


class NetworkTests(unittest.TestCase):
    def test_private_policy(self):
        for host in ("10.0.0.8", "172.16.0.8", "192.168.1.10"):
            self.assertTrue(private_ipv4(host))
        for host in ("", "localhost", "0.0.0.0", "127.0.0.1", "8.8.8.8", "192.0.2.1",
                     "169.254.1.2", "224.0.0.1", "240.0.0.1", "255.255.255.255"):
            self.assertFalse(private_ipv4(host))

    def test_access_hosts_and_lifecycle_destination(self):
        with patch("lazyfish.network.local_ipv4s", return_value={"127.0.0.1", "10.0.0.8", "192.168.1.10", "8.8.8.8"}):
            self.assertEqual(access_hosts("0.0.0.0"), ["127.0.0.1", "10.0.0.8", "192.168.1.10"])
            self.assertEqual(access_hosts("10.0.0.8"), ["10.0.0.8"])
            self.assertEqual(access_hosts("127.0.0.1"), ["127.0.0.1"])
        self.assertEqual(request_host("0.0.0.0"), "127.0.0.1")
        self.assertEqual(request_host("127.0.0.1"), "127.0.0.1")
        self.assertEqual(request_host("10.0.0.8"), "10.0.0.8")

    def test_interface_records_and_buffer_growth(self):
        stride = 40 if struct.calcsize("P") == 8 else 32
        calls = []
        def ioctl(fd, operation, argument):
            if operation == 0x8913:
                return struct.pack("16sH14x", argument[:16], 0x1)
            self.assertEqual(operation, 0x8912)
            size, pointer = struct.unpack("iP", argument)
            calls.append(size)
            if len(calls) == 1:
                return struct.pack("iP", size, pointer)
            records = bytearray(stride * 3)
            for offset, host in enumerate(("127.0.0.1", "10.0.0.8", "10.0.0.8")):
                struct.pack_into("H", records, offset * stride + 16, socket.AF_INET)
                records[offset * stride + 20:offset * stride + 24] = socket.inet_aton(host)
            ctypes.memmove(pointer, bytes(records), len(records))
            return struct.pack("iP", len(records), pointer)
        with patch("lazyfish.network.fcntl.ioctl", side_effect=ioctl):
            self.assertEqual(local_ipv4s(), {"127.0.0.1", "10.0.0.8"})
        self.assertEqual(calls[1], calls[0] * 2)

    def test_interface_failure_is_closed(self):
        with patch("lazyfish.network.fcntl.ioctl", side_effect=OSError("unavailable")):
            self.assertEqual(local_ipv4s(), set())
        with patch("lazyfish.network.local_ipv4s", return_value=set()):
            self.assertEqual(access_hosts("0.0.0.0"), ["127.0.0.1"])

    def test_down_interfaces_and_banner_filtering(self):
        stride = 40 if struct.calcsize("P") == 8 else 32
        interfaces = [
            ("lo", "127.0.0.1", True),
            ("eth0", "192.168.1.10", True),
            ("tun0", "10.0.0.8", True),
            ("eth1", "192.168.2.10", False),
            ("docker0", "172.17.0.1", True),
            ("br-a123", "172.18.0.1", True),
            ("veth123", "10.1.0.1", True),
            ("virbr0", "192.168.122.1", True),
            ("cni0", "10.2.0.1", True),
        ]
        flags = {name.encode(): up for name, _, up in interfaces}

        def ioctl(fd, operation, argument):
            if operation == 0x8913:
                name = argument[:16].split(b"\0", 1)[0]
                return struct.pack("16sH14x", name, int(flags[name]))
            self.assertEqual(operation, 0x8912)
            _, pointer = struct.unpack("iP", argument)
            records = bytearray(stride * len(interfaces))
            for i, (name, host, _) in enumerate(interfaces):
                struct.pack_into("16sH", records, i * stride, name.encode(), socket.AF_INET)
                records[i * stride + 20:i * stride + 24] = socket.inet_aton(host)
            ctypes.memmove(pointer, bytes(records), len(records))
            return struct.pack("iP", len(records), pointer)

        with patch("lazyfish.network.fcntl.ioctl", side_effect=ioctl):
            self.assertEqual(local_ipv4s(), {host for _, host, up in interfaces if up})
            self.assertEqual(local_ipv4s(for_display=True), {"127.0.0.1", "192.168.1.10", "10.0.0.8"})
            self.assertEqual(access_hosts("0.0.0.0"), ["127.0.0.1", "10.0.0.8", "192.168.1.10"])

    def test_invalid_interface_lengths_fail_closed(self):
        for length in (-1, 1024 * 1024):
            with self.subTest(length=length):
                with patch("lazyfish.network.fcntl.ioctl", return_value=struct.pack("iP", length, 0)):
                    self.assertEqual(local_ipv4s(), set())

    def test_interface_buffer_growth_is_bounded(self):
        with patch("lazyfish.network.fcntl.ioctl", side_effect=lambda fd, op, arg: arg):
            self.assertEqual(local_ipv4s(), set())
