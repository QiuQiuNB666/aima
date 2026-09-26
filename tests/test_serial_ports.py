"""串口发现只测枚举结果；所有串口打开和后台线程都被 mock。"""
from contextlib import ExitStack
from types import SimpleNamespace
import unittest
from unittest.mock import call, patch

from shellos.device import serial_link as SL


def port(device, vid=None, pid=None):
    return SimpleNamespace(device=device, vid=vid, pid=pid)


class SerialPortDiscoveryTests(unittest.TestCase):
    def setUp(self):
        patches = ExitStack()
        self.addCleanup(patches.close)
        self.serial = patches.enter_context(patch.object(
            SL.serial, "Serial", side_effect=AssertionError("真实串口访问被测试禁止")))
        self.thread = patches.enter_context(patch.object(SL.threading, "Thread"))
        self.comports = patches.enter_context(patch.object(SL.list_ports, "comports"))
        self.glob = patches.enter_context(patch.object(SL.glob, "glob", return_value=[]))
        patches.enter_context(patch.object(SL.sys, "platform", "win32"))

    def test_windows_no_device_explains_power_cable_and_driver(self):
        self.comports.return_value = []
        with self.assertRaises(RuntimeError) as error:
            SL.find_port()
        message = str(error.exception)
        for part in ("CP210x", "电源", "数据线", "Silicon Labs 官方", "驱动"):
            self.assertIn(part, message)
        self.glob.assert_not_called()
        self.serial.assert_not_called()

    def test_windows_unique_cp210x_returns_com_port(self):
        self.comports.return_value = [port("COM7", 0x10C4, 0xEA60)]
        self.assertEqual(SL.find_port(), "COM7")
        self.comports.assert_called_once_with()
        self.glob.assert_not_called()
        self.serial.assert_not_called()

    def test_windows_ignores_other_usb_and_bluetooth_ports(self):
        self.comports.return_value = [
            port("COM1"),                       # 蓝牙 / 无 USB 标识
            port("COM2", 0x1A86, 0x7523),       # 另一种 USB 串口桥
            port("COM3", 0x10C4, 0xEA70),       # 只有 VID 匹配
            port("COM4", 0x1234, 0xEA60),       # 只有 PID 匹配
            port("COM9", 0x10C4, 0xEA60),
        ]
        self.assertEqual(SL.find_port(), "COM9")
        self.serial.assert_not_called()

    def test_windows_unrelated_devices_do_not_count_as_candidates(self):
        self.comports.return_value = [port("COM1"), port("COM2", 0x1A86, 0x7523)]
        with self.assertRaisesRegex(RuntimeError, "没找到 CP210x 串口候选"):
            SL.find_port()
        self.serial.assert_not_called()

    def test_windows_multiple_candidates_require_explicit_port(self):
        self.comports.return_value = [
            port("COM8", 0x10C4, 0xEA60), port("COM3", 0x10C4, 0xEA60)]
        with self.assertRaises(RuntimeError) as error:
            SL.find_port()
        message = str(error.exception)
        self.assertIn("COM3, COM8", message)
        self.assertIn("--port COMx", message)
        self.serial.assert_not_called()

    def test_explicit_port_bypasses_discovery(self):
        self.serial.side_effect = None
        fake_serial = self.serial.return_value
        with patch.object(SL, "find_port") as find_port:
            link = SL.SerialLink("COM42")
        self.assertEqual(link.port, "COM42")
        self.assertIs(link.ser, fake_serial)
        self.serial.assert_called_once_with("COM42", SL.BAUD, timeout=0.05)
        find_port.assert_not_called()
        self.comports.assert_not_called()
        self.glob.assert_not_called()
        fake_serial.write.assert_not_called()
        self.thread.return_value.start.assert_called_once_with()

    def test_macos_and_linux_keep_sorted_glob_discovery(self):
        paths = {
            "/dev/cu.usbmodem*": ["/dev/cu.usbmodem2"],
            "/dev/cu.usbserial*": ["/dev/cu.usbserial1"],
            "/dev/ttyACM*": ["/dev/ttyACM0"],
            "/dev/ttyUSB*": ["/dev/ttyUSB0"],
        }
        for platform in ("darwin", "linux"):
            with self.subTest(platform=platform), patch.object(SL.sys, "platform", platform):
                self.glob.reset_mock()
                self.glob.side_effect = paths.__getitem__
                self.assertEqual(SL.find_port(), "/dev/cu.usbmodem2")
                self.assertEqual(self.glob.call_args_list, [call(pattern) for pattern in paths])
        self.comports.assert_not_called()
        self.serial.assert_not_called()

    def test_non_windows_no_device_keeps_existing_error(self):
        with patch.object(SL.sys, "platform", "linux"):
            with self.assertRaisesRegex(RuntimeError, "没找到串口：外骨骼插上了吗？开机了吗？"):
                SL.find_port()
        self.comports.assert_not_called()
        self.serial.assert_not_called()


if __name__ == "__main__":
    unittest.main()
