"""PySide6 presentation layer for the offline Local Text Workbench."""
import ctypes
import os
import sys

from PySide6.QtCore import QPoint, QRect, QSize, Qt, QTimer
from PySide6.QtGui import QAction, QCloseEvent, QFont, QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QApplication,
    QComboBox,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLayout,
    QMainWindow,
    QMenu,
    QPlainTextEdit,
    QPushButton,
    QSizePolicy,
    QSplitter,
    QToolButton,
    QVBoxLayout,
    QWidget,
)

from .hotkey import WindowsHotkey
from .processor import process
from .settings import SettingsStore


IS_WINDOWS = sys.platform == 'win32'
HOTKEY_ID = 0xB217
MOD_CONTROL = 0x0002
MOD_ALT = 0x0001
VK_SPACE = 0x20
UI_ACTIONS = ('Sanitize', 'Clean Logs', 'Sanitize + Clean')
PROCESSOR_ACTIONS = {
    'Sanitize': 'Sanitize',
    'Clean Logs': 'Clean logs',
    'Sanitize + Clean': 'Sanitize + clean',
}

WINDOW_BG = '#0F172A'
EDITOR_BG = '#090D16'
SURFACE_BG = '#1E293B'
BORDER = '#334155'
PRIMARY_TEXT = '#F1F5F9'
SECONDARY_TEXT = '#94A3B8'
ACCENT = '#34D399'
READY_STATUS = 'Ready. No input is stored to disk.'


APP_STYLESHEET = f"""
QMainWindow, QWidget#central {{ background: {WINDOW_BG}; color: {PRIMARY_TEXT}; font-family: "Segoe UI"; font-size: 10pt; }}
QMenuBar {{ background: {WINDOW_BG}; color: {SECONDARY_TEXT}; border: none; padding: 2px 8px; }}
QMenuBar::item {{ background: transparent; padding: 5px 9px; border-radius: 5px; }}
QMenuBar::item:selected {{ background: {SURFACE_BG}; color: {PRIMARY_TEXT}; }}
QMenu {{ background: {SURFACE_BG}; color: {PRIMARY_TEXT}; border: 1px solid {BORDER}; padding: 6px; }}
QMenu::item {{ padding: 7px 28px 7px 10px; border-radius: 5px; }}
QMenu::item:selected {{ background: #26364B; }}
QMenu::indicator:checked {{ background: {ACCENT}; border-radius: 4px; }}
QLabel#appTitle {{ color: {PRIMARY_TEXT}; font-size: 14pt; font-weight: 650; }}
QLabel#subtitle, QLabel#fieldLabel, QLabel#reviewLabel {{ color: {SECONDARY_TEXT}; }}
QLabel#fieldLabel {{ font-size: 8pt; font-weight: 700; letter-spacing: 0.7px; }}
QLabel#shortcut {{ color: #64748B; }}
QLabel#appIcon {{ background: #0B4D3F; color: {ACCENT}; border: 1px solid #278A70; border-radius: 10px; font-size: 14pt; font-weight: 700; }}
QLabel#localBadge {{ background: {SURFACE_BG}; color: {PRIMARY_TEXT}; border: 1px solid {BORDER}; border-radius: 14px; padding: 5px 11px; font-weight: 600; }}
QComboBox, QToolButton#optionsButton {{ background: {SURFACE_BG}; color: {PRIMARY_TEXT}; border: 1px solid {BORDER}; border-radius: 9px; min-height: 38px; padding: 0 12px; }}
QComboBox:hover, QToolButton#optionsButton:hover {{ border-color: #475569; background: #243247; }}
QComboBox:focus, QToolButton#optionsButton:focus {{ border-color: #278A70; }}
QComboBox::drop-down {{ border: none; width: 30px; }}
QComboBox QAbstractItemView {{ background: {SURFACE_BG}; color: {PRIMARY_TEXT}; selection-background-color: #065F46; border: 1px solid {BORDER}; outline: none; padding: 5px; }}
QPushButton#toggleChip {{ background: #172235; color: {SECONDARY_TEXT}; border: 1px solid {BORDER}; border-radius: 16px; min-height: 31px; padding: 0 13px; }}
QPushButton#toggleChip:checked {{ background: #123B35; color: {PRIMARY_TEXT}; border-color: #27735F; }}
QPushButton#toggleChip:hover {{ border-color: #4B647D; }}
QFrame#editorPanel {{ background: {SURFACE_BG}; border: 1px solid {BORDER}; border-radius: 12px; }}
QLabel#editorTitle {{ background: transparent; color: {SECONDARY_TEXT}; font-size: 8pt; font-weight: 700; letter-spacing: 0.7px; }}
QPlainTextEdit {{ background: {EDITOR_BG}; color: {PRIMARY_TEXT}; selection-background-color: #065F46; selection-color: {PRIMARY_TEXT}; border: none; border-radius: 8px; padding: 8px; font-family: "Consolas"; font-size: 10pt; }}
QScrollBar:vertical, QScrollBar:horizontal {{ background: {EDITOR_BG}; border: none; margin: 2px; }}
QScrollBar:vertical {{ width: 11px; }} QScrollBar:horizontal {{ height: 11px; }}
QScrollBar::handle:vertical, QScrollBar::handle:horizontal {{ background: #334155; border-radius: 4px; min-height: 28px; min-width: 28px; }}
QScrollBar::handle:vertical:hover, QScrollBar::handle:horizontal:hover {{ background: #475569; }}
QScrollBar::add-line, QScrollBar::sub-line {{ width: 0; height: 0; border: none; }}
QScrollBar::add-page, QScrollBar::sub-page {{ background: transparent; }}
QSplitter::handle {{ background: {WINDOW_BG}; width: 8px; }}
QPushButton#secondaryButton, QPushButton#detailsButton {{ background: {SURFACE_BG}; color: {PRIMARY_TEXT}; border: 1px solid {BORDER}; border-radius: 9px; min-height: 36px; padding: 0 15px; font-weight: 600; }}
QPushButton#secondaryButton:hover, QPushButton#detailsButton:hover {{ background: #26364B; border-color: #475569; }}
QPushButton#processButton {{ background: {ACCENT}; color: #052E26; border: 1px solid {ACCENT}; border-radius: 9px; min-height: 36px; padding: 0 18px; font-weight: 700; }}
QPushButton#processButton:hover {{ background: #45E0A6; border-color: #45E0A6; }}
QPushButton:focus {{ outline: none; border-color: {ACCENT}; }}
QLabel#summary {{ color: {PRIMARY_TEXT}; font-weight: 650; }}
QFrame#detailsPanel {{ background: {SURFACE_BG}; border: 1px solid {BORDER}; border-radius: 9px; }}
QLabel#detailsText {{ color: {SECONDARY_TEXT}; padding: 8px 10px; }}
QMessageBox {{ background: {WINDOW_BG}; }}
"""


class FlowLayout(QLayout):
    """Compact wrapping layout adapted from Qt's Flow Layout example."""

    def __init__(self, parent=None, margin=0, horizontal_spacing=8, vertical_spacing=8):
        super().__init__(parent)
        self._items = []
        self._horizontal_spacing = horizontal_spacing
        self._vertical_spacing = vertical_spacing
        self.setContentsMargins(margin, margin, margin, margin)

    def addItem(self, item):
        self._items.append(item)

    def count(self):
        return len(self._items)

    def itemAt(self, index):
        return self._items[index] if 0 <= index < len(self._items) else None

    def takeAt(self, index):
        return self._items.pop(index) if 0 <= index < len(self._items) else None

    def expandingDirections(self):
        return Qt.Orientation(0)

    def hasHeightForWidth(self):
        return True

    def heightForWidth(self, width):
        return self._arrange(QRect(0, 0, width, 0), test_only=True)

    def setGeometry(self, rect):
        super().setGeometry(rect)
        self._arrange(rect, test_only=False)

    def sizeHint(self):
        return self.minimumSize()

    def minimumSize(self):
        size = QSize()
        for item in self._items:
            size = size.expandedTo(item.minimumSize())
        margins = self.contentsMargins()
        return size + QSize(margins.left() + margins.right(), margins.top() + margins.bottom())

    def _arrange(self, rect, test_only):
        x = rect.x()
        y = rect.y()
        row_height = 0
        for item in self._items:
            hint = item.sizeHint()
            next_x = x + hint.width() + self._horizontal_spacing
            if next_x - self._horizontal_spacing > rect.right() and row_height > 0:
                x = rect.x()
                y += row_height + self._vertical_spacing
                next_x = x + hint.width() + self._horizontal_spacing
                row_height = 0
            if not test_only:
                item.setGeometry(QRect(QPoint(x, y), hint))
            x = next_x
            row_height = max(row_height, hint.height())
        return y + row_height - rect.y()


class ToggleChip(QPushButton):
    def __init__(self, label, checked, parent=None):
        super().__init__(parent)
        self.setObjectName('toggleChip')
        self.setCheckable(True)
        self.setChecked(checked)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Fixed)
        self._label = label
        self.toggled.connect(self._update_mark)
        self._update_mark(checked)

    def _update_mark(self, checked):
        self.setText(('✓ ' if checked else '· ') + self._label)


class Workbench(QMainWindow):
    def __init__(self, *, settings_store=None, hotkey_factory=WindowsHotkey):
        super().__init__()
        self.setWindowTitle('Local Text Workbench')
        self.resize(1180, 760)
        self.setMinimumSize(820, 620)
        self.setStyleSheet(APP_STYLESHEET)
        self.settings_store = settings_store or SettingsStore()
        self.log_cleanup_preferences = self.settings_store.load_log_cleanup_preferences()
        self._hotkey_factory = hotkey_factory
        self.hotkey = None
        self.hotkey_registered = False
        self._exiting = False
        self._details_visible = False
        self._build_ui()
        self._build_menu()
        self._build_shortcuts()
        self._register_hotkey()
        self.hotkey_timer = QTimer(self)
        self.hotkey_timer.setInterval(100)
        self.hotkey_timer.timeout.connect(self._poll_hotkey)
        self.hotkey_timer.start()

    def _build_ui(self):
        central = QWidget(self)
        central.setObjectName('central')
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)
        layout.setContentsMargins(22, 16, 22, 18)
        layout.setSpacing(13)

        header = QHBoxLayout()
        header.setSpacing(10)
        icon = QLabel('✓')
        icon.setObjectName('appIcon')
        icon.setAlignment(Qt.AlignmentFlag.AlignCenter)
        icon.setFixedSize(36, 36)
        header.addWidget(icon)
        title_stack = QVBoxLayout()
        title_stack.setSpacing(1)
        title = QLabel('Local Text Workbench')
        title.setObjectName('appTitle')
        title_stack.addWidget(title)
        subtitle_row = QHBoxLayout()
        subtitle_row.setSpacing(7)
        subtitle = QLabel('Private · Offline · Instant')
        subtitle.setObjectName('subtitle')
        shortcut = QLabel('•  Ctrl+Alt+Space')
        shortcut.setObjectName('shortcut')
        subtitle_row.addWidget(subtitle)
        subtitle_row.addWidget(shortcut)
        subtitle_row.addStretch(1)
        title_stack.addLayout(subtitle_row)
        header.addLayout(title_stack, 1)
        local_badge = QLabel('♢  Local')
        local_badge.setObjectName('localBadge')
        header.addWidget(local_badge)
        layout.addLayout(header)

        control_row = QHBoxLayout()
        control_row.setSpacing(12)
        action_field = self._field_container('ACTION')
        self.action_selector = QComboBox()
        self.action_selector.addItems(UI_ACTIONS)
        action_field.layout().addWidget(self.action_selector)
        control_row.addWidget(action_field, 1)
        self.options_field = self._field_container('OPTIONS')
        self.options_button = QToolButton()
        self.options_button.setObjectName('optionsButton')
        self.options_button.setText('Clean Logs settings')
        self.options_button.setPopupMode(QToolButton.ToolButtonPopupMode.InstantPopup)
        self.options_menu = QMenu(self.options_button)
        self.keep_actions = {}
        for key, label in (
            ('keep_timestamp', 'Keep timestamp'),
            ('keep_log_level', 'Keep log level'),
            ('keep_trace_id', 'Keep trace ID'),
            ('keep_username', 'Keep username'),
            ('keep_pid', 'Keep process ID (PID)'),
        ):
            action = QAction(label, self.options_menu)
            action.setCheckable(True)
            action.setChecked(self.log_cleanup_preferences[key])
            action.toggled.connect(self._save_log_cleanup_preferences)
            self.options_menu.addAction(action)
            self.keep_actions[key] = action
        self.options_button.setMenu(self.options_menu)
        self.options_field.layout().addWidget(self.options_button)
        control_row.addWidget(self.options_field, 1)
        layout.addLayout(control_row)
        self.action_selector.currentTextChanged.connect(self._update_action_settings_visibility)
        self._update_action_settings_visibility()

        global_label = QLabel('GLOBAL OPTIONS')
        global_label.setObjectName('fieldLabel')
        layout.addWidget(global_label)
        chips_host = QWidget()
        self.chip_layout = FlowLayout(chips_host)
        self.mask_ips = ToggleChip('Mask IPs', True)
        self.mask_emails = ToggleChip('Mask emails', True)
        self.mask_phones = ToggleChip('Mask phone candidates', False)
        self.remove_threads = ToggleChip('Remove threads', True)
        self.remove_loggers = ToggleChip('Remove logger names', True)
        self.global_chips = (self.mask_ips, self.mask_emails, self.mask_phones,
                             self.remove_threads, self.remove_loggers)
        for chip in self.global_chips:
            self.chip_layout.addWidget(chip)
        layout.addWidget(chips_host)

        self.splitter = QSplitter(Qt.Orientation.Horizontal)
        input_panel, self.input = self._editor_panel('INPUT', editable=True)
        output_panel, self.output = self._editor_panel('OUTPUT', editable=False)
        self.splitter.addWidget(input_panel)
        self.splitter.addWidget(output_panel)
        self.splitter.setChildrenCollapsible(False)
        self.splitter.setStretchFactor(0, 1)
        self.splitter.setStretchFactor(1, 1)
        self.splitter.setSizes([560, 560])
        layout.addWidget(self.splitter, 1)

        action_bar = QHBoxLayout()
        action_bar.setSpacing(8)
        self.summary_label = QLabel('Ready')
        self.summary_label.setObjectName('summary')
        action_bar.addWidget(self.summary_label)
        review = QLabel('·  Review before sharing')
        review.setObjectName('reviewLabel')
        action_bar.addWidget(review)
        self.details_button = QPushButton('Details')
        self.details_button.setObjectName('detailsButton')
        self.details_button.clicked.connect(self._toggle_details)
        action_bar.addWidget(self.details_button)
        action_bar.addStretch(1)
        self.paste_button = self._button('Paste', self.paste_clipboard)
        self.process_button = self._button('Process', self.run, primary=True)
        self.copy_button = self._button('Copy', self.copy_output)
        self.clear_button = self._button('Clear', self.clear)
        for button in (self.paste_button, self.process_button, self.copy_button, self.clear_button):
            action_bar.addWidget(button)
        layout.addLayout(action_bar)

        self.details_panel = QFrame()
        self.details_panel.setObjectName('detailsPanel')
        details_layout = QVBoxLayout(self.details_panel)
        details_layout.setContentsMargins(0, 0, 0, 0)
        self.details_label = QLabel('No processing details yet.')
        self.details_label.setObjectName('detailsText')
        self.details_label.setWordWrap(True)
        details_layout.addWidget(self.details_label)
        self.details_panel.hide()
        layout.addWidget(self.details_panel)
        self.status = READY_STATUS

    @staticmethod
    def _field_container(label):
        container = QWidget()
        field_layout = QVBoxLayout(container)
        field_layout.setContentsMargins(0, 0, 0, 0)
        field_layout.setSpacing(5)
        caption = QLabel(label)
        caption.setObjectName('fieldLabel')
        field_layout.addWidget(caption)
        return container

    @staticmethod
    def _editor_panel(title, *, editable):
        panel = QFrame()
        panel.setObjectName('editorPanel')
        panel_layout = QVBoxLayout(panel)
        panel_layout.setContentsMargins(1, 1, 1, 1)
        panel_layout.setSpacing(0)
        caption = QLabel(title)
        caption.setObjectName('editorTitle')
        caption.setContentsMargins(12, 8, 12, 8)
        panel_layout.addWidget(caption)
        editor = QPlainTextEdit()
        editor.setLineWrapMode(QPlainTextEdit.LineWrapMode.NoWrap)
        editor.setUndoRedoEnabled(editable)
        editor.setReadOnly(not editable)
        editor.setFont(QFont('Consolas', 10))
        panel_layout.addWidget(editor, 1)
        return panel, editor

    @staticmethod
    def _button(text, command, *, primary=False):
        button = QPushButton(text)
        button.setObjectName('processButton' if primary else 'secondaryButton')
        button.setCursor(Qt.CursorShape.PointingHandCursor)
        button.clicked.connect(command)
        return button

    def _build_menu(self):
        file_menu = self.menuBar().addMenu('File')
        file_menu.addAction('Open text file (max 10 MB)', self.open_file)
        file_menu.addSeparator()
        file_menu.addAction('Exit', self.exit)

    def _build_shortcuts(self):
        self.process_shortcut = QShortcut(QKeySequence('Ctrl+Return'), self)
        self.process_shortcut.activated.connect(self.run)
        self.copy_shortcut = QShortcut(QKeySequence('Ctrl+Shift+C'), self)
        self.copy_shortcut.activated.connect(self.copy_output)
        self.hide_shortcut = QShortcut(QKeySequence(Qt.Key.Key_Escape), self)
        self.hide_shortcut.activated.connect(self.hide_session)

    def _register_hotkey(self):
        if not IS_WINDOWS:
            self._set_status('Hotkey requires Windows. UI remains available.', 'Hotkey unavailable')
            return
        self.hotkey = self._hotkey_factory(MOD_CONTROL | MOD_ALT, VK_SPACE, HOTKEY_ID)
        self.hotkey_registered = self.hotkey.start()
        if not self.hotkey_registered:
            self._set_status('Could not register Ctrl+Alt+Space; another app may be using it. Keep this window open or restart it from the launcher.', 'Hotkey unavailable')

    def _poll_hotkey(self):
        if self.hotkey_registered and self.hotkey.consume_activation():
            self.show_session()

    def _update_action_settings_visibility(self, _text=None):
        self.options_field.setVisible(self.action_selector.currentText() == 'Clean Logs')

    def _save_log_cleanup_preferences(self, _checked=None):
        preferences = {key: action.isChecked() for key, action in self.keep_actions.items()}
        try:
            self.settings_store.save_log_cleanup_preferences(preferences)
        except OSError:
            self._set_status('Clean Logs settings changed for this session but could not be saved.', 'Preferences not saved')

    def _toggle_details(self):
        self._details_visible = not self._details_visible
        self.details_panel.setVisible(self._details_visible)
        self.details_button.setText('Hide' if self._details_visible else 'Details')

    def _set_status(self, detail, summary=None):
        self.status = detail
        self.details_label.setText(detail)
        self.summary_label.setText(summary or detail)

    def showEvent(self, event):
        super().showEvent(event)
        if IS_WINDOWS:
            QTimer.singleShot(0, self._enable_dark_title_bar)

    def _enable_dark_title_bar(self):
        try:
            hwnd = int(self.winId())
            enabled = ctypes.c_int(1)
            dwm = ctypes.windll.dwmapi
            if dwm.DwmSetWindowAttribute(hwnd, 20, ctypes.byref(enabled), ctypes.sizeof(enabled)):
                dwm.DwmSetWindowAttribute(hwnd, 19, ctypes.byref(enabled), ctypes.sizeof(enabled))
        except (AttributeError, OSError, ValueError):
            pass

    def show_session(self):
        self.showNormal()
        self.raise_()
        self.activateWindow()
        self.input.setFocus(Qt.FocusReason.ShortcutFocusReason)

    def hide_session(self):
        self._clear_session()
        self.hide()

    def closeEvent(self, event: QCloseEvent):
        if self._exiting:
            event.accept()
        else:
            self.hide_session()
            event.ignore()

    def paste_clipboard(self):
        value = QApplication.clipboard().text()
        if not value:
            self._set_status('Clipboard has no text.', 'Nothing to paste')
            return
        if len(value) > 2_000_000:
            self._set_status('Clipboard text exceeds 2 million characters. Use a dedicated streaming file tool for large logs.', 'Clipboard is too large')
            return
        self.input.setPlainText(value)
        self.input.document().clearUndoRedoStacks()
        self._clear_output()
        self._set_status(f'Pasted {len(value):,} characters. Raw text is not saved.', f'{len(value):,} characters pasted')

    def run(self):
        source = self.input.toPlainText()
        if not source.strip():
            self._set_status('Paste some text first.', 'Input is empty')
            return
        if len(source) > 2_000_000:
            self._set_status('Input too large for this preview. Use a streaming file tool.', 'Input is too large')
            return
        try:
            selected_action = self.action_selector.currentText()
            options = {
                'mask_ips': self.mask_ips.isChecked(),
                'mask_emails': self.mask_emails.isChecked(),
                'mask_phones': self.mask_phones.isChecked(),
                'remove_threads': self.remove_threads.isChecked(),
                'remove_loggers': self.remove_loggers.isChecked(),
            }
            if selected_action == 'Clean Logs':
                options.update({key: action.isChecked() for key, action in self.keep_actions.items()})
            result = process(source, PROCESSOR_ACTIONS[selected_action], **options)
        except Exception:
            self._set_status('Processing failed. Original input is unchanged.', 'Processing failed')
            return
        self.output.setPlainText(result.text)
        counts = ', '.join(f'{key}: {value}' for key, value in result.changes.items()) or 'No matching changes'
        details = counts + (' | ' + ' '.join(result.warnings) if result.warnings else '')
        change_total = sum(result.changes.values())
        self._set_status(details, f'{change_total} change' + ('' if change_total == 1 else 's'))

    def copy_output(self):
        text = self.output.toPlainText()
        if not text:
            self._set_status('No output to copy. Process input first.', 'Nothing to copy')
            return
        QApplication.clipboard().setText(text)
        self._set_status('Processed output copied. Review sensitive content before sharing.', 'Output copied')

    def clear(self):
        self._clear_session()
        self._set_status('Cleared. Clipboard unchanged.', 'Cleared')

    def _clear_session(self):
        self.input.clear()
        self.input.document().clearUndoRedoStacks()
        self._clear_output()
        self._set_status(READY_STATUS, 'Ready')
        if self._details_visible:
            self._toggle_details()

    def _clear_output(self):
        self.output.clear()
        self.output.document().clearUndoRedoStacks()

    def open_file(self):
        filename, _selected_filter = QFileDialog.getOpenFileName(self, 'Open text file', '', 'Text and logs (*.txt *.log *.json);;All files (*.*)')
        if not filename:
            return
        try:
            if os.path.getsize(filename) > 10_000_000:
                self._set_status('File exceeds 10 MB. Streaming file analysis is planned for the next release.', 'File is too large')
                return
            with open(filename, 'r', encoding='utf-8-sig') as file:
                text = file.read()
            if len(text) > 2_000_000:
                self._set_status('File text exceeds preview limit of 2 million characters.', 'File text is too large')
                return
            self.input.setPlainText(text)
            self.input.document().clearUndoRedoStacks()
            self._clear_output()
            self._set_status('File loaded into memory. No changes made to the file.', f'{len(text):,} characters loaded')
        except (OSError, UnicodeError):
            self._set_status('Unable to read file as UTF-8 text.', 'Unable to open file')

    def exit(self):
        if self._exiting:
            return
        self._exiting = True
        self._clear_session()
        self.hotkey_timer.stop()
        if self.hotkey is not None:
            self.hotkey.stop()
            self.hotkey = None
        self.hotkey_registered = False
        self.close()
        QApplication.instance().quit()


def main():
    application = QApplication.instance() or QApplication(sys.argv)
    application.setApplicationName('Local Text Workbench')
    application.setOrganizationName('Local Text Workbench')
    application.setQuitOnLastWindowClosed(False)
    application.setStyle('Fusion')
    application.setFont(QFont('Segoe UI', 10))
    window = Workbench()
    window.show()
    return application.exec()


if __name__ == '__main__':
    raise SystemExit(main())
