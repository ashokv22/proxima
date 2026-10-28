"""Deterministic, offline text processing. No raw text is persisted."""
import ipaddress
import json
import re
from dataclasses import dataclass

@dataclass
class Result:
    text: str
    changes: dict
    warnings: list[str]

SENSITIVE_KEYS = re.compile(r'(?i)(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|auth(?:orization)?|client[_-]?secret|private[_-]?key|session[_-]?id)')
EMAIL = re.compile(r'(?<![\w.+-])[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}(?![\w.-])')
IPV4 = re.compile(r'(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?!\w|\.\d)')
BEARER = re.compile(r'(?i)\b(Bearer\s+)([^\s,;"\']+)')
BASIC = re.compile(r'(?i)\b(Basic\s+)([A-Za-z0-9+/=]+)')
JWT = re.compile(r'(?<![\w.-])eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?![\w.-])')
AUTHORIZATION_HEADER = re.compile(r'(?im)(\bAuthorization\s*:\s*)[^\r\n]+')
ASSIGNMENT = re.compile(r'''(?im)(\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token|auth(?:orization)?|client[_-]?secret)\b\s*[=:]\s*)(?:Bearer\s+[^\s,;"']+|Basic\s+[A-Za-z0-9+/=]+|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;"'&]+)''')
QUERY_SECRET = re.compile(r'(?i)([?&](?:password|passwd|pwd|token|api[_-]?key|secret)=)[^&#\s]+')
URL_CREDENTIALS = re.compile(r'(?i)(\b[a-z][a-z0-9+.-]*://)[^\s/@:]+:[^\s/@]+@')
PHONE_IN = re.compile(r'(?<!\d)(?:\+91[\s-]?|0)?[6-9]\d{9}(?!\d)')
IPV6_CANDIDATE = re.compile(r'\[[0-9A-Fa-f:.]{2,}(?:%[\w.-]+)?\]|(?<![\w:.])[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]+(?:%[\w.-]+)?(?![\w:.])')
ANSI_SGR = re.compile(r'\x1b\[[0-9;]*m')
LOG_LEVEL = r'(?:TRACE|DEBUG|INFO|WARN|ERROR|FATAL)'
LOGGER_NAME = r'[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+'
THREAD_NAME = r'(?:tomcat-handler-[^\]\r\n]+|main|(?:https?-)?nio-[^\]\r\n]+|https-jsse-nio-[^\]\r\n]+|pool-[^\]\r\n]+|task-[^\]\r\n]+|async-[^\]\r\n]+|scheduling-[^\]\r\n]+|ForkJoinPool[^\]\r\n]*|reactor[^\]\r\n]*|XNIO[^\]\r\n]*|nioEventLoop[^\]\r\n]*)'
THREAD_BEFORE_LEVEL = re.compile(
    rf'(?m)^([^\r\n]*?)[ \t]+\[[ \t]*{THREAD_NAME}[ \t]*\][ \t]+(?={LOG_LEVEL}\b)'
)
THREAD_AFTER_LEVEL = re.compile(
    rf'(?m)^([^\r\n]*?\b{LOG_LEVEL}\b[^\r\n]*?)'
    rf'\[[ \t]*{THREAD_NAME}[ \t]*\][ \t]*'
    rf'(?=(?:\[[^\]\r\n]+\][ \t]*)*(?:{LOGGER_NAME})[ \t]*[:\-][ \t])'
)
SPRING_LOGGER = re.compile(
    rf'(?m)^([^\r\n]*?\b{LOG_LEVEL}\b[^\r\n]*?)[ \t]+---[ \t]+'
    rf'((?:\[[^\]\r\n]+\][ \t]+)*){LOGGER_NAME}[ \t]*:[ \t]*'
)
LOGGER = re.compile(
    rf'(?m)^([^\r\n]*?\b{LOG_LEVEL}\b[^\r\n]*?)[ \t]+{LOGGER_NAME}[ \t]*(?::|-)[ \t]*'
)
SPRING_LOG_LINE = re.compile(
    rf'^[^\r\n]*?\b{LOG_LEVEL}\b[^\r\n]*?{LOGGER_NAME}[ \t]*(?::|-)[ \t]'
)
HEADER_BEFORE_LOGGER = re.compile(
    rf'^([^\r\n]*?\b{LOG_LEVEL}\b)([^\r\n]*?)(?={LOGGER_NAME}[ \t]*(?::|-)[ \t])'
)
TIMESTAMP_START = re.compile(
    r'^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?[ \t]+'
)
LEVEL_TOKEN = re.compile(rf'\b{LOG_LEVEL}\b[ \t]*')
MDC_FIELD = re.compile(r'\[([^\]\r\n]*)\]([ \t]*)')
TRACE_ID = re.compile(
    r'(?i)(?:trace(?:_?id)?=)?(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{16}|[0-9a-f]{32})'
)


def sanitize(text: str, *, mask_ips=True, mask_emails=True, mask_phones=False) -> Result:
    counts = {}
    warnings = ['Automated redaction is best-effort. Review before sharing externally.']
    def sub(pattern, replacement, label, source):
        out, count = pattern.subn(replacement, source)
        if count:
            counts[label] = counts.get(label, 0) + count
        return out

    # Parse complete JSON when possible so nested sensitive keys are protected.
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        data = None
    if isinstance(data, (dict, list)):
        def redact(obj):
            if isinstance(obj, dict):
                result = {}
                for key, value in obj.items():
                    if SENSITIVE_KEYS.search(str(key)):
                        result[key] = '[REDACTED_SECRET]'
                        counts['sensitive JSON fields'] = counts.get('sensitive JSON fields', 0) + 1
                    else:
                        result[key] = redact(value)
                return result
            if isinstance(obj, list):
                return [redact(v) for v in obj]
            return obj
        text = json.dumps(redact(data), ensure_ascii=False, indent=2)

    text = sub(URL_CREDENTIALS, r'\1[REDACTED_CREDENTIALS]@', 'URL credentials', text)
    text = sub(AUTHORIZATION_HEADER, r'\1[REDACTED_TOKEN]', 'authorization headers', text)
    text = sub(BEARER, r'\1[REDACTED_TOKEN]', 'bearer tokens', text)
    text = sub(BASIC, r'\1[REDACTED_TOKEN]', 'basic credentials', text)
    text = sub(JWT, '[REDACTED_JWT]', 'JWTs', text)
    text = sub(QUERY_SECRET, r'\1[REDACTED_SECRET]', 'query secrets', text)
    text = sub(ASSIGNMENT, r'\1[REDACTED_SECRET]', 'assigned secrets', text)
    if mask_emails:
        text = sub(EMAIL, '[REDACTED_EMAIL]', 'emails', text)
    if mask_ips:
        def replace_ipv6(match):
            raw = match.group(0)
            candidate = raw[1:-1] if raw.startswith('[') and raw.endswith(']') else raw
            trailing = ''
            if not raw.startswith('['):
                trimmed = candidate.rstrip('.')
                trailing = candidate[len(trimmed):]
                candidate = trimmed
            candidate = candidate.split('%', 1)[0]
            try:
                ipaddress.IPv6Address(candidate)
                counts['IPv6 addresses'] = counts.get('IPv6 addresses', 0) + 1
                return '[REDACTED_IP]' + trailing
            except ipaddress.AddressValueError:
                return raw
        text = IPV6_CANDIDATE.sub(replace_ipv6, text)

        def replace_ipv4(match):
            try:
                ipaddress.IPv4Address(match.group(0))
                counts['IPv4 addresses'] = counts.get('IPv4 addresses', 0) + 1
                return '[REDACTED_IP]'
            except ipaddress.AddressValueError:
                return match.group(0)
        text = IPV4.sub(replace_ipv4, text)
    if mask_phones:
        text = sub(PHONE_IN, '[REDACTED_PHONE]', 'Indian phone candidates', text)
    return Result(text, counts, warnings)


def clean_logs(text: str, *, remove_threads=True, remove_loggers=True,
               keep_timestamp=True, keep_log_level=True, keep_trace_id=True,
               keep_username=True, keep_pid=True) -> Result:
    counts = {}
    text, ansi_count = ANSI_SGR.subn('', text)
    if ansi_count:
        counts['ANSI codes removed'] = ansi_count

    def filter_header_metadata(line):
        removed = {'trace IDs': 0, 'usernames': 0, 'PIDs': 0}

        def clean_header(match):
            header = match.group(2)
            fields = list(MDC_FIELD.finditer(header))
            mdc_index = None
            for index, field in enumerate(fields):
                values = [value.strip() for value in field.group(1).split(',')]
                if values and TRACE_ID.fullmatch(values[0]):
                    mdc_index = index
                    break

            replacements = {}
            if mdc_index is not None:
                mdc_field = fields[mdc_index]
                values = [value.strip() for value in mdc_field.group(1).split(',')]
                kept = []
                for index, value in enumerate(values):
                    if index == 0 and not keep_trace_id:
                        removed['trace IDs'] += 1
                    elif index == 1 and not keep_username:
                        removed['usernames'] += 1
                    elif value:
                        kept.append(value)
                replacements[mdc_index] = (
                    ('[' + ','.join(kept) + ']' + mdc_field.group(2)) if kept else ''
                )

                pid_index = mdc_index + 1
                if not keep_pid and pid_index < len(fields):
                    pid_field = fields[pid_index]
                    between = header[mdc_field.end():pid_field.start()]
                    if not between.strip() and pid_field.group(1).strip().isdigit():
                        replacements[pid_index] = ''
                        removed['PIDs'] += 1

            pieces = []
            position = 0
            for index, field in enumerate(fields):
                pieces.append(header[position:field.start()])
                pieces.append(replacements.get(index, field.group(0)))
                position = field.end()
            pieces.append(header[position:])
            header = ''.join(pieces)

            if not keep_pid:
                header, bare_pid_count = re.subn(
                    r'^([ \t]*)\d+[ \t]+(?=---)',
                    r'\1',
                    header,
                    count=1,
                )
                removed['PIDs'] += bare_pid_count
            return match.group(1) + header

        return HEADER_BEFORE_LOGGER.sub(clean_header, line, count=1), removed

    cleaned_lines = []
    thread_count = 0
    logger_count = 0
    trace_count = 0
    username_count = 0
    pid_count = 0
    timestamp_count = 0
    level_count = 0
    for line in text.splitlines(keepends=True):
        is_spring_log = bool(SPRING_LOG_LINE.search(line))
        if is_spring_log and (not keep_trace_id or not keep_username or not keep_pid):
            line, removed = filter_header_metadata(line)
            trace_count += removed['trace IDs']
            username_count += removed['usernames']
            pid_count += removed['PIDs']
        if remove_threads:
            line, before_count = THREAD_BEFORE_LEVEL.subn(r'\1 ', line)
            line, after_count = THREAD_AFTER_LEVEL.subn(r'\1', line)
            thread_count += before_count + after_count
        if is_spring_log and not keep_timestamp:
            line, removed = TIMESTAMP_START.subn('', line, count=1)
            timestamp_count += removed
        if remove_loggers:
            line, spring_count = SPRING_LOGGER.subn(r'\1 \2', line)
            line, fallback_count = LOGGER.subn(r'\1 ', line)
            logger_count += spring_count + fallback_count
        if is_spring_log and not keep_log_level:
            line, removed = LEVEL_TOKEN.subn('', line, count=1)
            level_count += removed
        cleaned_lines.append(line)

    if remove_threads:
        counts['threads removed'] = thread_count
    if remove_loggers:
        counts['logger names removed'] = logger_count
    if trace_count:
        counts['trace IDs removed'] = trace_count
    if username_count:
        counts['usernames removed'] = username_count
    if pid_count:
        counts['PIDs removed'] = pid_count
    if timestamp_count:
        counts['timestamps removed'] = timestamp_count
    if level_count:
        counts['log levels removed'] = level_count
    return Result(''.join(cleaned_lines), counts, ['Log cleanup uses conservative Spring-style patterns; verify uncommon formats.'])


def format_json(text: str, *, minify=False) -> Result:
    try:
        obj = json.loads(text)
    except json.JSONDecodeError as exc:
        return Result(text, {}, [f'Invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}'])
    output = json.dumps(obj, ensure_ascii=False, indent=None if minify else 2, separators=(',', ':') if minify else None)
    return Result(output, {'JSON formatted': 1}, [])


def process(text: str, action: str, *, mask_ips=True, mask_emails=True, mask_phones=False,
            remove_threads=True, remove_loggers=True, keep_timestamp=True,
            keep_log_level=True, keep_trace_id=True, keep_username=True,
            keep_pid=True) -> Result:
    if action == 'Sanitize':
        transformed = Result(text, {}, [])
    elif action == 'Clean logs':
        transformed = clean_logs(
            text,
            remove_threads=remove_threads,
            remove_loggers=remove_loggers,
            keep_timestamp=keep_timestamp,
            keep_log_level=keep_log_level,
            keep_trace_id=keep_trace_id,
            keep_username=keep_username,
            keep_pid=keep_pid,
        )
    elif action == 'Sanitize + clean':
        # The combined action intentionally keeps its established metadata defaults;
        # the five configurable metadata preferences belong only to Clean Logs.
        transformed = clean_logs(
            text,
            remove_threads=remove_threads,
            remove_loggers=remove_loggers,
        )
    elif action == 'Format JSON':
        return format_json(text)
    elif action == 'Minify JSON':
        return format_json(text, minify=True)
    else:
        raise ValueError('Unknown action')

    # All visible actions finish with exactly one protection pass. Optional
    # masks can be disabled independently without bypassing secret redaction.
    protected = sanitize(
        transformed.text,
        mask_ips=mask_ips,
        mask_emails=mask_emails,
        mask_phones=mask_phones,
    )
    changes = dict(transformed.changes)
    for label, count in protected.changes.items():
        changes[label] = changes.get(label, 0) + count
    return Result(protected.text, changes, transformed.warnings + protected.warnings)
