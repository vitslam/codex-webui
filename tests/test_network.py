import ctypes
import socket
import unittest
from unittest.mock import patch

from lazyfish import network
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

    def interfaces(self, platform, entries):
        buffers, nodes = [], []
        for name, address, up in entries:
            raw = bytearray(16)
            if platform == "darwin":
                raw[:2] = bytes((16, socket.AF_INET))
            else:
                raw[:2] = socket.AF_INET.to_bytes(2, __import__("sys").byteorder)
            if address:
                raw[4:8] = socket.inet_aton(address)
            buffer = ctypes.create_string_buffer(bytes(raw))
            buffers.append(buffer)
            node = network._Ifaddrs()
            node.name = name.encode()
            node.flags = int(up)
            node.addr = ctypes.addressof(buffer) if address else None
            nodes.append(node)
        for first, second in zip(nodes, nodes[1:]):
            first.next = ctypes.pointer(second)

        def getifaddrs(pointer):
            ctypes.cast(pointer, ctypes.POINTER(ctypes.POINTER(network._Ifaddrs)))[0] = ctypes.pointer(nodes[0])
            return 0
        return nodes, buffers, getifaddrs

    def test_native_records_on_linux_and_darwin(self):
        entries = [("lo0", "127.0.0.1", True), ("en0", "192.168.1.10", True),
                   ("utun0", "10.0.0.8", True), ("en1", "192.168.2.10", False),
                   ("docker0", "172.17.0.1", True), ("bridge0", "10.1.0.1", True),
                   ("awdl0", "10.2.0.1", True), ("llw0", "10.3.0.1", True),
                   ("empty", None, True), ("en0", "192.168.1.10", True)]
        for platform in ("linux", "darwin"):
            with self.subTest(platform=platform):
                nodes, buffers, get = self.interfaces(platform, entries)
                with patch.object(network.sys, "platform", platform), patch.object(network._libc, "getifaddrs", side_effect=get), patch.object(network._libc, "freeifaddrs") as free:
                    self.assertEqual(local_ipv4s(), {a for _, a, up in entries if a and up})
                    self.assertEqual(local_ipv4s(for_display=True), {"127.0.0.1", "192.168.1.10", "10.0.0.8"})
                    self.assertEqual(free.call_count, 2)

    def test_interface_failure_is_closed(self):
        with patch.object(network._libc, "getifaddrs", return_value=-1), patch.object(network._libc, "freeifaddrs") as free:
            self.assertEqual(local_ipv4s(), set())
            free.assert_not_called()
        with patch.object(network._libc, "getifaddrs", side_effect=OSError("unavailable")):
            self.assertEqual(local_ipv4s(), set())
        with patch("lazyfish.network.local_ipv4s", return_value=set()):
            self.assertEqual(access_hosts("0.0.0.0"), ["127.0.0.1"])

    def test_non_ipv4_is_ignored_and_memory_freed(self):
        nodes, buffers, get = self.interfaces("darwin", [("en0", "10.0.0.8", True)])
        buffers[0][1] = bytes((socket.AF_INET6,))
        with patch.object(network.sys, "platform", "darwin"), patch.object(network._libc, "getifaddrs", side_effect=get), patch.object(network._libc, "freeifaddrs") as free:
            self.assertEqual(local_ipv4s(), set())
            free.assert_called_once()
