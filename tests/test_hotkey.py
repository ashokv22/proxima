import threading
import unittest

from workbench.hotkey import WM_HOTKEY, WindowsHotkey


class FakeKernel32:
    @staticmethod
    def GetCurrentThreadId():
        return 123


class FakeUser32:
    def __init__(self, register=True):
        self.register = register
        self.delivered = threading.Event()
        self.stopped = threading.Event()
        self.unregistered = False
        self.message_count = 0

    @staticmethod
    def PeekMessageW(*_):
        return 0

    def RegisterHotKey(self, *_):
        return int(self.register)

    def GetMessageW(self, msg_pointer, *_):
        if self.message_count == 0:
            self.message_count += 1
            msg_pointer._obj.message = WM_HOTKEY
            msg_pointer._obj.wParam = 7
            self.delivered.set()
            return 1
        self.stopped.wait(1)
        return 0

    def PostThreadMessageW(self, *_):
        self.stopped.set()
        return 1

    def UnregisterHotKey(self, *_):
        self.unregistered = True
        return 1


class TestWindowsHotkey(unittest.TestCase):
    def test_activation_is_delivered_and_registration_is_cleaned_up(self):
        api = FakeUser32()
        listener = WindowsHotkey(3, 32, 7, user32=api, kernel32=FakeKernel32())
        self.assertTrue(listener.start())
        self.assertTrue(api.delivered.wait(1))
        self.assertTrue(listener.consume_activation())
        self.assertFalse(listener.consume_activation())
        listener.stop()
        self.assertTrue(api.unregistered)

    def test_registration_failure_is_reported(self):
        listener = WindowsHotkey(
            3, 32, 7, user32=FakeUser32(register=False), kernel32=FakeKernel32()
        )
        self.assertFalse(listener.start())


if __name__ == '__main__':
    unittest.main()
