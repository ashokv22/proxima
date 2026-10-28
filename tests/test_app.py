import os
import unittest
from pathlib import Path

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')

try:
    from PySide6.QtCore import Qt
    from PySide6.QtTest import QTest
    from PySide6.QtWidgets import QApplication, QPlainTextEdit, QSplitter
except ModuleNotFoundError:
    PYSIDE6_AVAILABLE = False
else:
    PYSIDE6_AVAILABLE = True
    from workbench.app import ACCENT, APP_STYLESHEET, EDITOR_BG, UI_ACTIONS, Workbench
    from workbench.settings import SettingsStore


class FakeHotkey:
    def __init__(self, *_args):
        self.activation = False
        self.stopped = False

    def start(self):
        return True

    def consume_activation(self):
        activated = self.activation
        self.activation = False
        return activated

    def stop(self):
        self.stopped = True


@unittest.skipUnless(PYSIDE6_AVAILABLE, 'PySide6 is required for Qt GUI smoke tests')
class TestQtWorkbench(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.qt_app = QApplication.instance() or QApplication([])
        cls.qt_app.setQuitOnLastWindowClosed(False)

    def setUp(self):
        self.settings_path = Path('tests/.qt-settings-test.json')
        self.settings_path.unlink(missing_ok=True)
        self.hotkey = FakeHotkey()
        self.window = Workbench(
            settings_store=SettingsStore(self.settings_path),
            hotkey_factory=lambda *_args: self.hotkey,
        )
        self.window.show()
        QApplication.processEvents()

    def tearDown(self):
        if self.window is not None:
            self.window.hotkey_timer.stop()
            self.window._exiting = True
            self.window.close()
            self.window.deleteLater()
            QApplication.processEvents()
        self.settings_path.unlink(missing_ok=True)

    def test_layout_uses_qsplitter_dark_editors_and_centralized_theme(self):
        self.assertIsInstance(self.window.splitter, QSplitter)
        self.assertEqual(self.window.splitter.count(), 2)
        self.assertIsInstance(self.window.input, QPlainTextEdit)
        self.assertIsInstance(self.window.output, QPlainTextEdit)
        self.assertEqual(self.window.input.lineWrapMode(), QPlainTextEdit.LineWrapMode.NoWrap)
        self.assertEqual(self.window.output.lineWrapMode(), QPlainTextEdit.LineWrapMode.NoWrap)
        self.assertTrue(self.window.output.isReadOnly())
        self.assertIn(f'background: {EDITOR_BG}', APP_STYLESHEET)
        self.assertIn(f'background: {ACCENT}', APP_STYLESHEET)
        self.assertIn('QScrollBar:vertical', APP_STYLESHEET)

    def test_actions_and_clean_log_options_visibility(self):
        self.assertEqual(
            tuple(self.window.action_selector.itemText(index)
                  for index in range(self.window.action_selector.count())),
            UI_ACTIONS,
        )
        self.assertFalse(self.window.options_field.isVisible())
        self.window.action_selector.setCurrentText('Clean Logs')
        QApplication.processEvents()
        self.assertTrue(self.window.options_field.isVisible())
        self.window.action_selector.setCurrentText('Sanitize + Clean')
        QApplication.processEvents()
        self.assertFalse(self.window.options_field.isVisible())

    def test_global_chips_toggle_existing_processing_options(self):
        for chip in self.window.global_chips:
            with self.subTest(chip=chip.text()):
                original = chip.isChecked()
                chip.click()
                self.assertEqual(chip.isChecked(), not original)
                chip.click()
                self.assertEqual(chip.isChecked(), original)

    def test_all_three_actions_route_to_processor(self):
        source = 'email=a@example.com password=hunter2'
        for action in UI_ACTIONS:
            with self.subTest(action=action):
                self.window.action_selector.setCurrentText(action)
                self.window.input.setPlainText(source)
                self.window.run()
                output = self.window.output.toPlainText()
                self.assertNotIn('a@example.com', output)
                self.assertNotIn('hunter2', output)

    def test_clean_log_preferences_persist(self):
        self.window.action_selector.setCurrentText('Clean Logs')
        self.window.keep_actions['keep_trace_id'].setChecked(False)
        QApplication.processEvents()
        loaded = SettingsStore(self.settings_path).load_log_cleanup_preferences()
        self.assertFalse(loaded['keep_trace_id'])
        self.assertTrue(loaded['keep_timestamp'])

    def test_clipboard_buttons_process_and_clear(self):
        QApplication.clipboard().setText('email=a@example.com')
        self.window.paste_button.click()
        self.assertEqual(self.window.input.toPlainText(), 'email=a@example.com')
        self.window.process_button.click()
        self.assertEqual(self.window.output.toPlainText(), 'email=[REDACTED_EMAIL]')
        self.window.copy_button.click()
        self.assertEqual(QApplication.clipboard().text(), 'email=[REDACTED_EMAIL]')
        self.window.clear_button.click()
        self.assertEqual(self.window.input.toPlainText(), '')
        self.assertEqual(self.window.output.toPlainText(), '')

    def test_ctrl_enter_processes_without_modifying_input(self):
        source = 'email=a@example.com'
        self.window.input.setPlainText(source)
        self.window.input.setFocus()
        QTest.keyClick(self.window.input, Qt.Key.Key_Return, Qt.KeyboardModifier.ControlModifier)
        QApplication.processEvents()
        self.assertEqual(self.window.input.toPlainText(), source)
        self.assertEqual(self.window.output.toPlainText(), 'email=[REDACTED_EMAIL]')

    def test_details_remain_collapsed_until_requested(self):
        self.window.input.setPlainText('email=a@example.com')
        self.window.run()
        self.assertFalse(self.window.details_panel.isVisible())
        self.window.details_button.click()
        self.assertTrue(self.window.details_panel.isVisible())
        self.assertIn('emails: 1', self.window.details_label.text())

    def test_close_clears_sensitive_session_and_hotkey_reopens_fresh(self):
        self.window.input.setPlainText('sensitive input')
        self.window.output.setPlainText('sensitive output')
        self.window.close()
        QApplication.processEvents()
        self.assertFalse(self.window.isVisible())
        self.assertEqual(self.window.input.toPlainText(), '')
        self.assertEqual(self.window.output.toPlainText(), '')
        self.assertFalse(self.hotkey.stopped)

        self.hotkey.activation = True
        self.window.hotkey_timer.timeout.emit()
        QApplication.processEvents()
        self.assertTrue(self.window.isVisible())
        self.assertEqual(self.window.input.toPlainText(), '')
        self.assertEqual(self.window.output.toPlainText(), '')

    def test_exit_stops_hotkey_timer_listener_and_closes_window(self):
        self.window.exit()
        QApplication.processEvents()
        self.assertFalse(self.window.hotkey_timer.isActive())
        self.assertTrue(self.hotkey.stopped)
        self.assertFalse(self.window.isVisible())
        self.window = None

    def test_splitter_remains_usable_at_minimum_size(self):
        self.window.resize(self.window.minimumSize())
        QApplication.processEvents()
        sizes = self.window.splitter.sizes()
        self.assertEqual(len(sizes), 2)
        self.assertTrue(all(size > 200 for size in sizes))


if __name__ == '__main__':
    unittest.main()
