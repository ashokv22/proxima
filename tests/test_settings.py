import json
import unittest
from pathlib import Path

from workbench.settings import DEFAULT_LOG_CLEANUP_PREFERENCES, SettingsStore


class TestSettingsStore(unittest.TestCase):
    def test_log_cleanup_preferences_persist_without_content_data(self):
        path = Path('tests/.settings-roundtrip-test.json')
        self.addCleanup(path.unlink, missing_ok=True)
        temporary_path = path.with_suffix('.tmp')
        self.addCleanup(temporary_path.unlink, missing_ok=True)
        try:
            store = SettingsStore(path)
            preferences = {
                'keep_timestamp': False,
                'keep_log_level': True,
                'keep_trace_id': False,
                'keep_username': True,
                'keep_pid': False,
            }

            store.save_log_cleanup_preferences(preferences)

            self.assertEqual(SettingsStore(path).load_log_cleanup_preferences(), preferences)
            self.assertEqual(json.loads(path.read_text(encoding='utf-8')), preferences)
        finally:
            temporary_path.unlink(missing_ok=True)
            path.unlink(missing_ok=True)

    def test_missing_or_invalid_settings_use_safe_defaults(self):
        path = Path('tests/.settings-invalid-test.json')
        self.addCleanup(path.unlink, missing_ok=True)
        try:
            store = SettingsStore(path)
            self.assertEqual(store.load_log_cleanup_preferences(), DEFAULT_LOG_CLEANUP_PREFERENCES)

            path.write_text('{"keep_timestamp": "no", "clipboard": "raw text"}', encoding='utf-8')
            self.assertEqual(store.load_log_cleanup_preferences(), DEFAULT_LOG_CLEANUP_PREFERENCES)
        finally:
            path.unlink(missing_ok=True)

    def test_existing_three_preference_file_gets_enabled_new_defaults(self):
        path = Path('tests/.settings-legacy-test.json')
        self.addCleanup(path.unlink, missing_ok=True)
        try:
            path.write_text(
                '{"keep_timestamp": false, "keep_log_level": true, "keep_trace_id": false}',
                encoding='utf-8',
            )
            self.assertEqual(
                SettingsStore(path).load_log_cleanup_preferences(),
                {
                    'keep_timestamp': False,
                    'keep_log_level': True,
                    'keep_trace_id': False,
                    'keep_username': True,
                    'keep_pid': True,
                },
            )
        finally:
            path.unlink(missing_ok=True)


if __name__ == '__main__':
    unittest.main()
