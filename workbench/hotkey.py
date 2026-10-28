"""Windows global-hotkey listener with its own message-pump thread."""
import ctypes
import queue
import threading
from ctypes import wintypes


WM_QUIT = 0x0012
WM_HOTKEY = 0x0312
PM_NOREMOVE = 0x0000


class WindowsHotkey:
    """Register a thread-level hotkey without competing with Tk's message pump."""

    def __init__(self, modifiers, virtual_key, hotkey_id, *, user32=None, kernel32=None):
        self.modifiers = modifiers
        self.virtual_key = virtual_key
        self.hotkey_id = hotkey_id
        self._user32 = user32 if user32 is not None else ctypes.windll.user32
        self._kernel32 = kernel32 if kernel32 is not None else ctypes.windll.kernel32
        self._ready = threading.Event()
        self._activations = queue.SimpleQueue()
        self._thread = None
        self._thread_id = None
        self._started_successfully = False

    def start(self, timeout=1.0):
        self._thread = threading.Thread(target=self._message_loop, name='workbench-hotkey', daemon=True)
        self._thread.start()
        if not self._ready.wait(timeout):
            return False
        return self._started_successfully

    def _message_loop(self):
        msg = wintypes.MSG()
        # Force Windows to create this thread's message queue before another
        # thread may try to post WM_QUIT to it.
        self._user32.PeekMessageW(ctypes.byref(msg), None, 0, 0, PM_NOREMOVE)
        self._thread_id = self._kernel32.GetCurrentThreadId()
        self._started_successfully = bool(
            self._user32.RegisterHotKey(None, self.hotkey_id, self.modifiers, self.virtual_key)
        )
        self._ready.set()
        if not self._started_successfully:
            return
        try:
            while True:
                result = self._user32.GetMessageW(ctypes.byref(msg), None, 0, 0)
                if result <= 0:
                    break
                if msg.message == WM_HOTKEY and msg.wParam == self.hotkey_id:
                    self._activations.put(True)
        finally:
            self._user32.UnregisterHotKey(None, self.hotkey_id)

    def consume_activation(self):
        try:
            self._activations.get_nowait()
            return True
        except queue.Empty:
            return False

    def stop(self, timeout=1.0):
        if self._thread and self._thread.is_alive() and self._thread_id is not None:
            self._user32.PostThreadMessageW(self._thread_id, WM_QUIT, 0, 0)
            self._thread.join(timeout)

