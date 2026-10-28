import unittest
import json
from itertools import product
from pathlib import Path
from workbench.processor import sanitize, clean_logs, format_json, process

class TestProcessor(unittest.TestCase):
    ANSI_SPRING_LOG = (
        '2026-10-15 11:04:14.992 [tomcat-handler-406854] '
        '\x1b[39mDEBUG\x1b[0;39m '
        '[de48fff6-c1b9-461d-bd7c-a7704ee9ab51,anonymous] [2649128] --- '
        '\x1b[32mc.s.d.a.f.clients.dcb.IvrOtpClient\x1b[0;39m : '
        '[IvrOtpClient#searchOtp] <--- HTTP/1.1 200 OK (1808ms)'
    )
    CLEANED_ANSI_SPRING_LOG = (
        '2026-10-15 11:04:14.992 DEBUG '
        '[de48fff6-c1b9-461d-bd7c-a7704ee9ab51,anonymous] [2649128] '
        '[IvrOtpClient#searchOtp] <--- HTTP/1.1 200 OK (1808ms)'
    )

    def test_shared_rust_python_parity_fixtures(self):
        path = Path(__file__).with_name('processor_parity_cases.json')
        action_names = {
            'Clean Logs': 'Clean logs',
            'Sanitize + Clean': 'Sanitize + clean',
        }
        option_names = {
            'maskIps': 'mask_ips',
            'maskEmails': 'mask_emails',
            'maskPhones': 'mask_phones',
            'removeThreads': 'remove_threads',
            'removeLoggers': 'remove_loggers',
            'keepTimestamp': 'keep_timestamp',
            'keepLogLevel': 'keep_log_level',
            'keepTraceId': 'keep_trace_id',
            'keepUsername': 'keep_username',
            'keepPid': 'keep_pid',
        }
        cases = json.loads(path.read_text(encoding='utf-8'))
        for case in cases:
            with self.subTest(case=case['name']):
                options = {
                    option_names[key]: value
                    for group in ('globalOptions', 'logMetadata')
                    for key, value in case[group].items()
                }
                result = process(
                    case['text'],
                    action_names.get(case['action'], case['action']),
                    **options,
                )
                self.assertEqual(result.text, case['expected']['text'])
                self.assertEqual(result.changes, case['expected']['changes'])
                self.assertEqual(result.warnings, case['expected']['warnings'])

    def test_clean_real_world_ansi_spring_log(self):
        self.assertEqual(clean_logs(self.ANSI_SPRING_LOG).text, self.CLEANED_ANSI_SPRING_LOG)

    def test_clean_multiline_feign_response_preserves_headers_body_and_entries(self):
        prefix = (
            '2026-10-15 11:04:14.992 [tomcat-handler-406854] DEBUG '
            '[de48fff6-c1b9-461d-bd7c-a7704ee9ab51,anonymous] [2649128] --- '
            'com.example.client.IvrOtpClient : '
        )
        source = '\n'.join((
            prefix + '[IvrOtpClient#searchOtp] <--- HTTP/1.1 200 OK',
            prefix + '[IvrOtpClient#searchOtp] content-type: application/json',
            prefix + '[IvrOtpClient#searchOtp] x-request-id: req-123',
            prefix + '[IvrOtpClient#searchOtp] {"status":"ok"}',
            'nonmatching continuation line',
        ))
        expected = '\n'.join((
            '2026-10-15 11:04:14.992 DEBUG [de48fff6-c1b9-461d-bd7c-a7704ee9ab51,anonymous] [2649128] [IvrOtpClient#searchOtp] <--- HTTP/1.1 200 OK',
            '2026-10-15 11:04:14.992 DEBUG [de48fff6-c1b9-461d-bd7c-a7704ee9ab51,anonymous] [2649128] [IvrOtpClient#searchOtp] content-type: application/json',
            '2026-10-15 11:04:14.992 DEBUG [de48fff6-c1b9-461d-bd7c-a7704ee9ab51,anonymous] [2649128] [IvrOtpClient#searchOtp] x-request-id: req-123',
            '2026-10-15 11:04:14.992 DEBUG [de48fff6-c1b9-461d-bd7c-a7704ee9ab51,anonymous] [2649128] [IvrOtpClient#searchOtp] {"status":"ok"}',
            'nonmatching continuation line',
        ))
        self.assertEqual(clean_logs(source).text, expected)
        self.assertEqual(clean_logs(source).text.count('[IvrOtpClient#searchOtp]'), 4)

    def test_combined_action_sanitizes_and_cleans_ansi_log(self):
        source = self.ANSI_SPRING_LOG + ' user=a@example.com'
        result = process(source, 'Sanitize + clean').text
        self.assertNotIn('\x1b[', result)
        self.assertNotIn('tomcat-handler-406854', result)
        self.assertNotIn('c.s.d.a.f.clients.dcb.IvrOtpClient', result)
        self.assertNotIn('a@example.com', result)
        self.assertIn('[REDACTED_EMAIL]', result)
        self.assertIn('[de48fff6-c1b9-461d-bd7c-a7704ee9ab51,anonymous]', result)
        self.assertIn('[2649128]', result)
        self.assertIn('[IvrOtpClient#searchOtp]', result)

    def test_clean_log_metadata_options_all_32_combinations(self):
        stack = '\njava.lang.IllegalStateException: boom\n\tat com.example.Service.run(Service.java:42)'
        message = '[IvrOtpClient#searchOtp] <--- HTTP/1.1 200 OK (1808ms)'
        for options in product((True, False), repeat=5):
            with self.subTest(options=options):
                keep_timestamp, keep_log_level, keep_trace_id, keep_username, keep_pid = options
                fields = []
                if keep_timestamp:
                    fields.append('2026-10-15 11:04:14.992')
                if keep_log_level:
                    fields.append('DEBUG')
                mdc_values = []
                if keep_trace_id:
                    mdc_values.append('de48fff6-c1b9-461d-bd7c-a7704ee9ab51')
                if keep_username:
                    mdc_values.append('anonymous')
                if mdc_values:
                    fields.append('[' + ','.join(mdc_values) + ']')
                if keep_pid:
                    fields.append('[2649128]')
                fields.append(message)
                result = clean_logs(
                    self.ANSI_SPRING_LOG + stack,
                    keep_timestamp=keep_timestamp,
                    keep_log_level=keep_log_level,
                    keep_trace_id=keep_trace_id,
                    keep_username=keep_username,
                    keep_pid=keep_pid,
                ).text
                self.assertEqual(result, ' '.join(fields) + stack)

    def test_combined_action_ignores_clean_log_metadata_preferences(self):
        result = process(
            self.ANSI_SPRING_LOG,
            'Sanitize + clean',
            keep_timestamp=False,
            keep_log_level=False,
            keep_trace_id=False,
            keep_username=False,
            keep_pid=False,
        ).text
        self.assertEqual(result, self.CLEANED_ANSI_SPRING_LOG)

    def test_removing_trace_id_preserves_trace_shaped_lead_id(self):
        source = (
            '2026-10-15 11:04:14.992 DEBUG '
            '[de48fff6-c1b9-461d-bd7c-a7704ee9ab51,user] [abcdefabcdefabcd] --- '
            'com.example.Client : message'
        )
        expected = '2026-10-15 11:04:14.992 DEBUG [user] [abcdefabcdefabcd] message'
        self.assertEqual(clean_logs(source, keep_trace_id=False).text, expected)

    def test_metadata_options_apply_to_thread_after_level_format(self):
        source = (
            '2026-10-22T10:11:12.123Z INFO 1234 --- [http-nio-8080-exec-7] '
            '[de48fff6-c1b9-461d-bd7c-a7704ee9ab51,user] [2649128] '
            'com.example.CustomerService : failed'
        )
        result = clean_logs(
            source,
            keep_timestamp=False,
            keep_log_level=False,
            keep_trace_id=False,
        ).text
        self.assertEqual(result, '1234 [user] [2649128] failed')

    def test_username_and_pid_can_be_toggled_independently(self):
        message = '[IvrOtpClient#searchOtp] <--- HTTP/1.1 200 OK (1808ms)'
        cases = (
            (
                {'keep_username': False, 'keep_pid': False},
                message,
            ),
            (
                {'keep_username': True, 'keep_pid': False},
                '[anonymous] ' + message,
            ),
            (
                {'keep_username': False, 'keep_pid': True},
                '[2649128] ' + message,
            ),
        )
        for options, expected in cases:
            with self.subTest(options=options):
                result = clean_logs(
                    self.ANSI_SPRING_LOG,
                    keep_timestamp=False,
                    keep_log_level=False,
                    keep_trace_id=False,
                    **options,
                ).text
                self.assertEqual(result, expected)

    def test_actual_username_is_preserved(self):
        source = self.ANSI_SPRING_LOG.replace(',anonymous]', ',jane.doe]')
        result = clean_logs(source, keep_trace_id=False).text
        self.assertIn('[jane.doe]', result)

    def test_pid_option_does_not_remove_numeric_message_fields(self):
        source = self.ANSI_SPRING_LOG + ' response-field=[8675309]'
        result = clean_logs(source, keep_pid=False).text
        self.assertNotIn('[2649128]', result)
        self.assertIn('response-field=[8675309]', result)

    def test_sensitive_json(self):
        x = sanitize('{"password":"abc","nested":{"apiKey":"xyz","email":"a@b.com"}}').text
        self.assertNotIn('abc', x)
        self.assertNotIn('xyz', x)
        self.assertNotIn('a@b.com', x)

    def test_sensitive_json_fields_in_arrays_and_non_string_values(self):
        result = sanitize('[{"access_token":123},{"privateKey":null}]')
        self.assertEqual(result.text.count('[REDACTED_SECRET]'), 2)
    def test_log_redaction(self):
        x = sanitize('Authorization: Bearer abc123 IP 192.168.1.10 email a@b.com password=hello').text
        for secret in ('abc123','192.168.1.10','a@b.com','hello'):
            self.assertNotIn(secret, x)
    def test_invalid_ip(self):
        self.assertIn('999.999.999.999', sanitize('999.999.999.999').text)

    def test_ipv6_with_brackets_port_and_zone(self):
        source = 'remote=[2001:db8::1]:8443 local=[fe80::1%12]:443'
        result = sanitize(source)
        self.assertEqual(result.text, 'remote=[REDACTED_IP]:8443 local=[REDACTED_IP]:443')
        self.assertEqual(result.changes['IPv6 addresses'], 2)

    def test_ip_at_sentence_end_preserves_punctuation(self):
        source = 'IPv4 192.168.1.10. IPv6 2001:db8::1.'
        self.assertEqual(
            sanitize(source).text,
            'IPv4 [REDACTED_IP]. IPv6 [REDACTED_IP].',
        )

    def test_quoted_and_generic_credentials(self):
        source = 'password="hello world"\nAuthorization: opaque-secret\ntoken=Bearer abc123'
        result = sanitize(source).text
        for secret in ('hello', 'world', 'opaque-secret', 'abc123'):
            self.assertNotIn(secret, result)

    def test_common_token_and_credential_forms(self):
        source = (
            'Basic dXNlcjpwYXNz '
            'jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature '
            'url=https://user:pass@example.test/path?api_key=query-secret'
        )
        result = sanitize(source).text
        for secret in ('dXNlcjpwYXNz', 'eyJhbGciOiJIUzI1NiJ9', 'user:pass', 'query-secret'):
            self.assertNotIn(secret, result)
    def test_clean_log(self):
        x = clean_logs('2026-10-22 INFO [http-nio-8080-exec-7] com.example.CustomerService - failed').text
        self.assertNotIn('http-nio', x)
        self.assertNotIn('com.example', x)
        self.assertIn('2026-10-22 INFO', x)
        self.assertIn('failed', x)

    def test_clean_typical_spring_log_preserves_context_and_stack_trace(self):
        source = (
            '2026-10-22T10:11:12.123Z INFO 1234 --- '
            '[http-nio-8080-exec-7] [req-abc] com.example.CustomerService : failed\n'
            'java.lang.IllegalStateException: boom\n'
            '\tat com.example.CustomerService.run(CustomerService.java:42)'
        )
        result = clean_logs(source).text
        self.assertIn('2026-10-22T10:11:12.123Z INFO', result)
        self.assertIn('[req-abc]', result)
        self.assertNotIn('[http-nio-8080-exec-7]', result)
        self.assertNotIn('com.example.CustomerService : failed', result.splitlines()[0])
        self.assertIn('java.lang.IllegalStateException: boom', result)
        self.assertIn('at com.example.CustomerService.run(CustomerService.java:42)', result)

    def test_clean_padded_main_and_modern_nio_thread(self):
        source = (
            '2026-10-22 INFO --- [           main] com.example.Startup : ready\n'
            '2026-10-22 INFO --- [nio-8080-exec-1] com.example.Web : served'
        )
        result = clean_logs(source).text
        self.assertNotIn('[           main]', result)
        self.assertNotIn('[nio-8080-exec-1]', result)

    def test_clean_logs_does_not_remove_thread_like_message_text(self):
        source = 'Plain text asks the user to select [main] from the menu.'
        self.assertEqual(clean_logs(source).text, source)
    def test_json_error_preserves_input(self):
        r = format_json('{oops')
        self.assertEqual(r.text, '{oops')
        self.assertTrue(r.warnings)
    def test_json_pretty(self):
        self.assertIn('\n', format_json('{"a":1}').text)

    def test_json_minify_preserves_unicode(self):
        self.assertEqual(format_json('{"name": "café"}', minify=True).text, '{"name":"café"}')

    def test_mask_options_can_be_disabled(self):
        source = '192.168.1.10 a@example.com'
        result = sanitize(source, mask_ips=False, mask_emails=False).text
        self.assertEqual(result, source)

    def test_global_ip_and_email_mask_combinations_apply_to_every_action(self):
        actions = ('Sanitize', 'Clean logs', 'Sanitize + clean')
        source = 'peer=192.168.1.10 email=user@example.com'
        for action in actions:
            for mask_ips, mask_emails in product((True, False), repeat=2):
                with self.subTest(action=action, mask_ips=mask_ips, mask_emails=mask_emails):
                    result = process(
                        source,
                        action,
                        mask_ips=mask_ips,
                        mask_emails=mask_emails,
                    ).text
                    if mask_ips:
                        self.assertIn('[REDACTED_IP]', result)
                        self.assertNotIn('192.168.1.10', result)
                    else:
                        self.assertIn('192.168.1.10', result)
                    if mask_emails:
                        self.assertIn('[REDACTED_EMAIL]', result)
                        self.assertNotIn('user@example.com', result)
                    else:
                        self.assertIn('user@example.com', result)

    def test_global_phone_mask_applies_to_every_action_only_when_enabled(self):
        for action in ('Sanitize', 'Clean logs', 'Sanitize + clean'):
            for mask_phones in (True, False):
                with self.subTest(action=action, mask_phones=mask_phones):
                    result = process(
                        'phone=9876543210',
                        action,
                        mask_ips=False,
                        mask_emails=False,
                        mask_phones=mask_phones,
                    ).text
                    if mask_phones:
                        self.assertEqual(result, 'phone=[REDACTED_PHONE]')
                    else:
                        self.assertEqual(result, 'phone=9876543210')

    def test_all_global_mask_combinations_apply_independently_to_every_action(self):
        source = '192.168.1.10 user@example.com 9876543210'
        for action in ('Sanitize', 'Clean logs', 'Sanitize + clean'):
            for options in product((True, False), repeat=3):
                mask_ips, mask_emails, mask_phones = options
                with self.subTest(action=action, options=options):
                    result = process(
                        source,
                        action,
                        mask_ips=mask_ips,
                        mask_emails=mask_emails,
                        mask_phones=mask_phones,
                    ).text
                    self.assertEqual('[REDACTED_IP]' in result, mask_ips)
                    self.assertEqual('[REDACTED_EMAIL]' in result, mask_emails)
                    self.assertEqual('[REDACTED_PHONE]' in result, mask_phones)

    def test_mandatory_credentials_and_tokens_are_redacted_for_every_action(self):
        source = 'password=hunter2\nrequest Bearer opaque-token'
        for action in ('Sanitize', 'Clean logs', 'Sanitize + clean'):
            with self.subTest(action=action):
                result = process(
                    source,
                    action,
                    mask_ips=False,
                    mask_emails=False,
                    mask_phones=False,
                ).text
                self.assertNotIn('hunter2', result)
                self.assertNotIn('opaque-token', result)
                self.assertIn('[REDACTED_SECRET]', result)
                self.assertIn('[REDACTED_TOKEN]', result)

    def test_sensitive_json_fields_are_redacted_for_every_action(self):
        source = '{"password":"hunter2","nested":{"apiKey":"opaque-key"}}'
        for action in ('Sanitize', 'Clean logs', 'Sanitize + clean'):
            with self.subTest(action=action):
                result = process(
                    source,
                    action,
                    mask_ips=False,
                    mask_emails=False,
                    mask_phones=False,
                )
                self.assertNotIn('hunter2', result.text)
                self.assertNotIn('opaque-key', result.text)
                self.assertEqual(result.changes['sensitive JSON fields'], 2)

    def test_processing_summary_combines_cleanup_and_global_masks(self):
        source = (
            '2026-10-22 INFO [http-nio-8080-exec-7] '
            'com.example.CustomerService - peer=10.0.0.1 email=a@example.com'
        )
        result = process(source, 'Clean logs')
        self.assertEqual(result.changes['threads removed'], 1)
        self.assertEqual(result.changes['logger names removed'], 1)
        self.assertEqual(result.changes['IPv4 addresses'], 1)
        self.assertEqual(result.changes['emails'], 1)

    def test_unknown_action_is_rejected(self):
        with self.assertRaises(ValueError):
            process('text', 'Unsupported')
    def test_combined(self):
        x = process('INFO [http-nio-8080-exec-1] com.example.Foo - 10.0.0.1', 'Sanitize + clean').text
        self.assertIn('[REDACTED_IP]', x)
        self.assertNotIn('http-nio', x)

if __name__ == '__main__':
    unittest.main()
