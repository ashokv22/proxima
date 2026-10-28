"""Local preferences for the workbench. Never stores processed text."""
import json
import os
from pathlib import Path


DEFAULT_LOG_CLEANUP_PREFERENCES = {
    'keep_timestamp': True,
    'keep_log_level': True,
    'keep_trace_id': True,
    'keep_username': True,
    'keep_pid': True,
}


def default_settings_path():
    base = os.environ.get('LOCALAPPDATA')
    if base:
        return Path(base) / 'LocalTextWorkbench' / 'settings.json'
    return Path.home() / '.local_text_workbench' / 'settings.json'


class SettingsStore:
    def __init__(self, path=None):
        self.path = Path(path) if path is not None else default_settings_path()

    def load_log_cleanup_preferences(self):
        try:
            data = json.loads(self.path.read_text(encoding='utf-8'))
        except (OSError, UnicodeError, json.JSONDecodeError):
            return DEFAULT_LOG_CLEANUP_PREFERENCES.copy()
        if not isinstance(data, dict) or not set(data).issubset(DEFAULT_LOG_CLEANUP_PREFERENCES):
            return DEFAULT_LOG_CLEANUP_PREFERENCES.copy()
        if not all(isinstance(value, bool) for value in data.values()):
            return DEFAULT_LOG_CLEANUP_PREFERENCES.copy()
        preferences = DEFAULT_LOG_CLEANUP_PREFERENCES.copy()
        preferences.update(data)
        return preferences

    def save_log_cleanup_preferences(self, preferences):
        if set(preferences) != set(DEFAULT_LOG_CLEANUP_PREFERENCES):
            raise ValueError('Unexpected log-cleanup preference')
        if not all(isinstance(preferences[key], bool) for key in DEFAULT_LOG_CLEANUP_PREFERENCES):
            raise ValueError('Log-cleanup preferences must be booleans')
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = self.path.with_suffix('.tmp')
        temporary_path.write_text(
            json.dumps(preferences, indent=2, sort_keys=True),
            encoding='utf-8',
        )
        temporary_path.replace(self.path)
