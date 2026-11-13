import ctypes
from dataclasses import replace
import http.client
import socket
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from lazyfish import network
from lazyfish.network import access_hosts, bindable_ipv4, local_ipv4s, private_ipv4, request_host
from lazyfish.telemetry import Timings
from lazyfish.web.server import Server
from support import IsolatedTest


class HTTPBindingTests(IsolatedTest):
    def test_web_listener_binds_numeric_addresses_without_reverse_dns(self):
        # HTTPServer normally resolves its name between bind() and listen().
        # A stalled resolver must not delay either loopback or wildcard startup.
        with patch("socket.getfqdn", side_effect=AssertionError("Unexpected reverse DNS")):
            for host in ("127.0.0.1", "0.0.0.0"):
                with self.subTest(host=host), Server(replace(self.settings, host=host),
                                                   {"ready": True}, "fixture") as server:
                    self.assertEqual(server.server_name, host)
                    self.assertEqual(server.server_port, server.server_address[1])
                    self.assertGreater(server.server_port, 0)
                    with socket.create_connection(("127.0.0.1", server.server_port), timeout=1):
                        pass  # The socket must already be listening, not only bound.

    def test_timing_listener_starts_and_serves_without_reverse_dns(self):
        with patch("socket.getfqdn", side_effect=AssertionError("Unexpected reverse DNS")):
            timings = Timings(SimpleNamespace())
            try:
                connection = http.client.HTTPConnection("127.0.0.1", timings.server.server_port, timeout=2)
                try:
                    connection.request("POST", timings.route, b'{"resourceSpans":[]}')
                    response = connection.getresponse()
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.read(), b"{}")
                finally:
                    connection.close()
            finally:
                timings.close()


class NetworkTests(unittest.TestCase):
    def test_private_policy(self):
        for host in ("10.0.0.8", "172.16.0.8", "192.168.1.10"):
            self.assertTrue(private_ipv4(host))
        for host in ("", "localhost", "0.0.0.0", "127.0.0.1", "8.8.8.8", "192.0.2.1",
                     "169.254.1.2", "224.0.0.1", "240.0.0.1", "255.255.255.255"):
            self.assertFalse(private_ipv4(host))

    def test_bindable_ipv4(self):
        for host in ("0.0.0.0", "127.0.0.1", "127.0.0.2", "10.0.0.8", "8.8.8.8",
                     "192.0.2.1", "169.254.1.2", "240.0.0.1"):
            self.assertTrue(bindable_ipv4(host), host)
        for host in ("", "localhost", "255.255.255.255", "224.0.0.1", "::1",
                     "not-an-ip", None, 123):
            self.assertFalse(bindable_ipv4(host), host)

    def test_access_hosts_and_lifecycle_destination(self):
        with patch("lazyfish.network.local_ipv4s", return_value={"127.0.0.1", "10.0.0.8", "192.168.1.10", "8.8.8.8"}):
            self.assertEqual(access_hosts("0.0.0.0"),
                             ["127.0.0.1", "10.0.0.8", "192.168.1.10", "8.8.8.8"])
            self.assertEqual(access_hosts("10.0.0.8"), ["10.0.0.8"])
            self.assertEqual(access_hosts("8.8.8.8"), ["8.8.8.8"])
            self.assertEqual(access_hosts("127.0.0.1"), ["127.0.0.1"])
        self.assertEqual(request_host("0.0.0.0"), "127.0.0.1")
        self.assertEqual(request_host("127.0.0.1"), "127.0.0.1")
        self.assertEqual(request_host("10.0.0.8"), "10.0.0.8")
        self.assertEqual(request_host("8.8.8.8"), "8.8.8.8")

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
