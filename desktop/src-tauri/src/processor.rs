use std::net::{Ipv4Addr, Ipv6Addr};
use std::str::FromStr;
use std::sync::LazyLock;

use indexmap::IndexMap;
use regex::{Captures, Regex};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const SANITIZE_WARNING: &str =
    "Automated redaction is best-effort. Review before sharing externally.";
const CLEAN_WARNING: &str =
    "Log cleanup uses conservative Spring-style patterns; verify uncommon formats.";

static SENSITIVE_KEYS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|auth(?:orization)?|client[_-]?secret|private[_-]?key|session[_-]?id)").unwrap()
});
static EMAIL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}").unwrap());
static IPV4: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?:\d{1,3}\.){3}\d{1,3}").unwrap());
static BEARER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)\b(Bearer\s+)([^\s,;"']+)"#).unwrap());
static BASIC: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(Basic\s+)([A-Za-z0-9+/=]+)").unwrap());
static JWT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+").unwrap());
static AUTHORIZATION_HEADER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?im)(\bAuthorization\s*:\s*)[^\r\n]+").unwrap());
static ASSIGNMENT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?im)(\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token|auth(?:orization)?|client[_-]?secret)\b\s*[=:]\s*)(?:Bearer\s+[^\s,;"']+|Basic\s+[A-Za-z0-9+/=]+|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;"'&]+)"#).unwrap()
});
static QUERY_SECRET: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)([?&](?:password|passwd|pwd|token|api[_-]?key|secret)=)[^&#\s]+").unwrap()
});
static URL_CREDENTIALS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b([a-z][a-z0-9+.-]*://)[^\s/@:]+:[^\s/@]+@").unwrap());
static PHONE_IN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:\+91[\s-]?|0)?[6-9]\d{9}").unwrap());
static IPV6_CANDIDATE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[[0-9A-Fa-f:.]{2,}(?:%[\w.-]+)?\]|[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]+(?:%[\w.-]+)?")
        .unwrap()
});
static ANSI_SGR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\x1b\[[0-9;]*m").unwrap());

const LOG_LEVEL: &str = r"(?:TRACE|DEBUG|INFO|WARN|ERROR|FATAL)";
const LOGGER_NAME: &str = r"[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+";
const THREAD_NAME: &str = r"(?:tomcat-handler-[^\]\r\n]+|main|(?:https?-)?nio-[^\]\r\n]+|https-jsse-nio-[^\]\r\n]+|pool-[^\]\r\n]+|task-[^\]\r\n]+|async-[^\]\r\n]+|scheduling-[^\]\r\n]+|ForkJoinPool[^\]\r\n]*|reactor[^\]\r\n]*|XNIO[^\]\r\n]*|nioEventLoop[^\]\r\n]*)";

static THREAD_BEFORE_LEVEL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r"(?m)^([^\r\n]*?)[ \t]+\[[ \t]*{THREAD_NAME}[ \t]*\][ \t]+({LOG_LEVEL}\b)"
    ))
    .unwrap()
});
static THREAD_AFTER_LEVEL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r"(?m)^([^\r\n]*?\b{LOG_LEVEL}\b[^\r\n]*?)\[[ \t]*{THREAD_NAME}[ \t]*\][ \t]*((?:\[[^\]\r\n]+\][ \t]*)*(?:{LOGGER_NAME})[ \t]*[:\-][ \t])"
    ))
    .unwrap()
});
static SPRING_LOGGER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r"(?m)^([^\r\n]*?\b{LOG_LEVEL}\b[^\r\n]*?)[ \t]+---[ \t]+((?:\[[^\]\r\n]+\][ \t]+)*){LOGGER_NAME}[ \t]*:[ \t]*"
    ))
    .unwrap()
});
static LOGGER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r"(?m)^([^\r\n]*?\b{LOG_LEVEL}\b[^\r\n]*?)[ \t]+{LOGGER_NAME}[ \t]*(?::|-)[ \t]*"
    ))
    .unwrap()
});
static SPRING_LOG_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r"^[^\r\n]*?\b{LOG_LEVEL}\b[^\r\n]*?{LOGGER_NAME}[ \t]*(?::|-)[ \t]"
    ))
    .unwrap()
});
static HEADER_BEFORE_LOGGER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r"^([^\r\n]*?\b{LOG_LEVEL}\b)([^\r\n]*?)({LOGGER_NAME}[ \t]*(?::|-)[ \t])"
    ))
    .unwrap()
});
static TIMESTAMP_START: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?[ \t]+",
    )
    .unwrap()
});
static LEVEL_TOKEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(&format!(r"\b{LOG_LEVEL}\b[ \t]*")).unwrap());
static MDC_FIELD: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[([^\]\r\n]*)\]([ \t]*)").unwrap());
static TRACE_ID: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:trace(?:_?id)?=)?(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{16}|[0-9a-f]{32})$").unwrap()
});
static BARE_PID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^([ \t]*)\d+[ \t]+(---)").unwrap());

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GlobalOptions {
    pub mask_ips: bool,
    pub mask_emails: bool,
    pub mask_phones: bool,
    pub remove_threads: bool,
    pub remove_loggers: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogMetadataOptions {
    pub keep_timestamp: bool,
    pub keep_log_level: bool,
    pub keep_trace_id: bool,
    pub keep_username: bool,
    pub keep_pid: bool,
}

impl Default for LogMetadataOptions {
    fn default() -> Self {
        Self {
            keep_timestamp: true,
            keep_log_level: true,
            keep_trace_id: true,
            keep_username: true,
            keep_pid: true,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProcessRequest {
    pub text: String,
    pub action: String,
    pub global_options: GlobalOptions,
    pub log_metadata: LogMetadataOptions,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessResult {
    pub text: String,
    pub changes: IndexMap<String, usize>,
    pub warnings: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pretty_evidence: Option<String>,
}

impl ProcessResult {
    fn unchanged(text: String) -> Self {
        Self {
            text,
            changes: IndexMap::new(),
            warnings: Vec::new(),
            pretty_evidence: None,
        }
    }
}

fn increment(changes: &mut IndexMap<String, usize>, label: &str, count: usize) {
    if count > 0 {
        *changes.entry(label.to_owned()).or_default() += count;
    }
}

fn replace_count(
    text: String,
    regex: &Regex,
    replacement: &str,
    label: &str,
    changes: &mut IndexMap<String, usize>,
) -> String {
    let count = regex.find_iter(&text).count();
    increment(changes, label, count);
    regex.replace_all(&text, replacement).into_owned()
}

fn char_before(text: &str, byte: usize) -> Option<char> {
    text[..byte].chars().next_back()
}

fn char_after(text: &str, byte: usize) -> Option<char> {
    text[byte..].chars().next()
}

fn is_word(character: char) -> bool {
    character == '_' || character.is_alphanumeric()
}

fn replace_candidates<F>(
    text: String,
    regex: &Regex,
    replacement: &str,
    label: &str,
    changes: &mut IndexMap<String, usize>,
    mut accept: F,
) -> String
where
    F: FnMut(&str, usize, usize) -> bool,
{
    let source = text;
    let mut count = 0;
    let output = regex.replace_all(&source, |captures: &Captures<'_>| {
        let matched = captures.get(0).unwrap();
        if accept(matched.as_str(), matched.start(), matched.end()) {
            count += 1;
            replacement.to_owned()
        } else {
            matched.as_str().to_owned()
        }
    });
    increment(changes, label, count);
    output.into_owned()
}

fn redact_json(value: &mut Value, count: &mut usize) {
    match value {
        Value::Object(object) => {
            for (key, child) in object.iter_mut() {
                if SENSITIVE_KEYS.is_match(key) {
                    *child = Value::String("[REDACTED_SECRET]".to_owned());
                    *count += 1;
                } else {
                    redact_json(child, count);
                }
            }
        }
        Value::Array(items) => {
            for child in items {
                redact_json(child, count);
            }
        }
        _ => {}
    }
}

pub fn sanitize(text: &str, mask_ips: bool, mask_emails: bool, mask_phones: bool) -> ProcessResult {
    let mut changes = IndexMap::new();
    let mut output = text.to_owned();

    if let Ok(mut json) = serde_json::from_str::<Value>(text) {
        if matches!(json, Value::Object(_) | Value::Array(_)) {
            let mut count = 0;
            redact_json(&mut json, &mut count);
            increment(&mut changes, "sensitive JSON fields", count);
            output =
                serde_json::to_string_pretty(&json).expect("serializing JSON value cannot fail");
        }
    }

    output = replace_count(
        output,
        &URL_CREDENTIALS,
        "$1[REDACTED_CREDENTIALS]@",
        "URL credentials",
        &mut changes,
    );
    output = replace_count(
        output,
        &AUTHORIZATION_HEADER,
        "$1[REDACTED_TOKEN]",
        "authorization headers",
        &mut changes,
    );
    output = replace_count(
        output,
        &BEARER,
        "$1[REDACTED_TOKEN]",
        "bearer tokens",
        &mut changes,
    );
    output = replace_count(
        output,
        &BASIC,
        "$1[REDACTED_TOKEN]",
        "basic credentials",
        &mut changes,
    );
    let jwt_source = output.clone();
    output = replace_candidates(
        output,
        &JWT,
        "[REDACTED_JWT]",
        "JWTs",
        &mut changes,
        |_, start, end| {
            !char_before(&jwt_source, start).is_some_and(|c| is_word(c) || c == '.' || c == '-')
                && !char_after(&jwt_source, end).is_some_and(|c| is_word(c) || c == '.' || c == '-')
        },
    );
    output = replace_count(
        output,
        &QUERY_SECRET,
        "$1[REDACTED_SECRET]",
        "query secrets",
        &mut changes,
    );
    output = replace_count(
        output,
        &ASSIGNMENT,
        "$1[REDACTED_SECRET]",
        "assigned secrets",
        &mut changes,
    );

    if mask_emails {
        let email_source = output.clone();
        output = replace_candidates(
            output,
            &EMAIL,
            "[REDACTED_EMAIL]",
            "emails",
            &mut changes,
            |_, start, end| {
                !char_before(&email_source, start)
                    .is_some_and(|c| is_word(c) || matches!(c, '.' | '+' | '-'))
                    && !char_after(&email_source, end)
                        .is_some_and(|c| is_word(c) || matches!(c, '.' | '-'))
            },
        );
    }

    if mask_ips {
        let ipv6_source = output.clone();
        output = {
            let mut count = 0;
            let replaced = IPV6_CANDIDATE.replace_all(&output, |captures: &Captures<'_>| {
                let matched = captures.get(0).unwrap();
                let raw = matched.as_str();
                let bracketed = raw.starts_with('[') && raw.ends_with(']');
                if !bracketed
                    && (char_before(&ipv6_source, matched.start())
                        .is_some_and(|c| is_word(c) || c == ':' || c == '.')
                        || char_after(&ipv6_source, matched.end())
                            .is_some_and(|c| is_word(c) || c == ':'))
                {
                    return raw.to_owned();
                }
                let inside = if bracketed {
                    &raw[1..raw.len() - 1]
                } else {
                    raw
                };
                let trimmed = if bracketed {
                    inside
                } else {
                    inside.trim_end_matches('.')
                };
                let trailing = &inside[trimmed.len()..];
                let address = trimmed.split('%').next().unwrap_or(trimmed);
                if Ipv6Addr::from_str(address).is_ok() {
                    count += 1;
                    format!("[REDACTED_IP]{trailing}")
                } else {
                    raw.to_owned()
                }
            });
            increment(&mut changes, "IPv6 addresses", count);
            replaced.into_owned()
        };

        let ipv4_source = output.clone();
        output = replace_candidates(
            output,
            &IPV4,
            "[REDACTED_IP]",
            "IPv4 addresses",
            &mut changes,
            |raw, start, end| {
                let invalid_before =
                    char_before(&ipv4_source, start).is_some_and(|c| is_word(c) || c == '.');
                let invalid_after = char_after(&ipv4_source, end).is_some_and(|c| {
                    is_word(c)
                        || (c == '.'
                            && ipv4_source[end + c.len_utf8()..]
                                .chars()
                                .next()
                                .is_some_and(|next| next.is_ascii_digit()))
                });
                !invalid_before && !invalid_after && Ipv4Addr::from_str(raw).is_ok()
            },
        );
    }

    if mask_phones {
        let phone_source = output.clone();
        output = replace_candidates(
            output,
            &PHONE_IN,
            "[REDACTED_PHONE]",
            "Indian phone candidates",
            &mut changes,
            |_, start, end| {
                !char_before(&phone_source, start).is_some_and(|c| c.is_ascii_digit())
                    && !char_after(&phone_source, end).is_some_and(|c| c.is_ascii_digit())
            },
        );
    }

    ProcessResult {
        text: output,
        changes,
        warnings: vec![SANITIZE_WARNING.to_owned()],
        pretty_evidence: None,
    }
}

fn clean_header_metadata(
    line: String,
    options: &LogMetadataOptions,
) -> (String, usize, usize, usize) {
    let Some(captures) = HEADER_BEFORE_LOGGER.captures(&line) else {
        return (line, 0, 0, 0);
    };
    let prefix = captures.get(1).unwrap().as_str();
    let header_match = captures.get(2).unwrap();
    let header = header_match.as_str();
    let logger_start = captures.get(3).unwrap().start();
    let fields: Vec<_> = MDC_FIELD.captures_iter(header).collect();
    let mdc_index = fields.iter().position(|field| {
        field
            .get(1)
            .unwrap()
            .as_str()
            .split(',')
            .next()
            .is_some_and(|value| TRACE_ID.is_match(value.trim()))
    });
    let mut replacements: Vec<Option<String>> = vec![None; fields.len()];
    let (mut trace_count, mut username_count, mut pid_count) = (0, 0, 0);

    if let Some(index) = mdc_index {
        let field = &fields[index];
        let values: Vec<_> = field
            .get(1)
            .unwrap()
            .as_str()
            .split(',')
            .map(str::trim)
            .collect();
        let mut kept = Vec::new();
        for (value_index, value) in values.iter().enumerate() {
            if value_index == 0 && !options.keep_trace_id {
                trace_count += 1;
            } else if value_index == 1 && !options.keep_username {
                username_count += 1;
            } else if !value.is_empty() {
                kept.push(*value);
            }
        }
        replacements[index] = Some(if kept.is_empty() {
            String::new()
        } else {
            format!("[{}]{}", kept.join(","), field.get(2).unwrap().as_str())
        });

        let pid_index = index + 1;
        if !options.keep_pid && pid_index < fields.len() {
            let pid_field = &fields[pid_index];
            let between = &header[field.get(0).unwrap().end()..pid_field.get(0).unwrap().start()];
            if between.trim().is_empty()
                && pid_field
                    .get(1)
                    .unwrap()
                    .as_str()
                    .trim()
                    .chars()
                    .all(|c| c.is_ascii_digit())
            {
                replacements[pid_index] = Some(String::new());
                pid_count += 1;
            }
        }
    }

    let mut rebuilt = String::new();
    let mut position = 0;
    for (index, field) in fields.iter().enumerate() {
        let whole = field.get(0).unwrap();
        rebuilt.push_str(&header[position..whole.start()]);
        rebuilt.push_str(replacements[index].as_deref().unwrap_or(whole.as_str()));
        position = whole.end();
    }
    rebuilt.push_str(&header[position..]);

    if !options.keep_pid && BARE_PID.is_match(&rebuilt) {
        rebuilt = BARE_PID.replacen(&rebuilt, 1, "$1$2").into_owned();
        pid_count += 1;
    }

    (
        format!("{prefix}{rebuilt}{}", &line[logger_start..]),
        trace_count,
        username_count,
        pid_count,
    )
}

pub fn clean_logs(
    text: &str,
    remove_threads: bool,
    remove_loggers: bool,
    options: &LogMetadataOptions,
) -> ProcessResult {
    let mut changes = IndexMap::new();
    let ansi_count = ANSI_SGR.find_iter(text).count();
    increment(&mut changes, "ANSI codes removed", ansi_count);
    let without_ansi = ANSI_SGR.replace_all(text, "").into_owned();

    let mut cleaned = String::with_capacity(without_ansi.len());
    let (mut thread_count, mut logger_count) = (0, 0);
    let (mut trace_count, mut username_count, mut pid_count) = (0, 0, 0);
    let (mut timestamp_count, mut level_count) = (0, 0);

    for source_line in without_ansi.split_inclusive('\n') {
        let mut line = source_line.to_owned();
        let is_spring_log = SPRING_LOG_LINE.is_match(&line);

        if is_spring_log && (!options.keep_trace_id || !options.keep_username || !options.keep_pid)
        {
            let (next, traces, usernames, pids) = clean_header_metadata(line, options);
            line = next;
            trace_count += traces;
            username_count += usernames;
            pid_count += pids;
        }

        if remove_threads {
            let before = THREAD_BEFORE_LEVEL.find_iter(&line).count();
            line = THREAD_BEFORE_LEVEL.replace_all(&line, "$1 $2").into_owned();
            let after = THREAD_AFTER_LEVEL.find_iter(&line).count();
            line = THREAD_AFTER_LEVEL.replace_all(&line, "$1$2").into_owned();
            thread_count += before + after;
        }

        if is_spring_log && !options.keep_timestamp && TIMESTAMP_START.is_match(&line) {
            line = TIMESTAMP_START.replacen(&line, 1, "").into_owned();
            timestamp_count += 1;
        }

        if remove_loggers {
            let spring = SPRING_LOGGER.find_iter(&line).count();
            line = SPRING_LOGGER.replace_all(&line, "$1 $2").into_owned();
            let fallback = LOGGER.find_iter(&line).count();
            line = LOGGER.replace_all(&line, "$1 ").into_owned();
            logger_count += spring + fallback;
        }

        if is_spring_log && !options.keep_log_level && LEVEL_TOKEN.is_match(&line) {
            line = LEVEL_TOKEN.replacen(&line, 1, "").into_owned();
            level_count += 1;
        }
        cleaned.push_str(&line);
    }

    if remove_threads {
        changes.insert("threads removed".to_owned(), thread_count);
    }
    if remove_loggers {
        changes.insert("logger names removed".to_owned(), logger_count);
    }
    increment(&mut changes, "trace IDs removed", trace_count);
    increment(&mut changes, "usernames removed", username_count);
    increment(&mut changes, "PIDs removed", pid_count);
    increment(&mut changes, "timestamps removed", timestamp_count);
    increment(&mut changes, "log levels removed", level_count);

    ProcessResult {
        text: cleaned,
        changes,
        warnings: vec![CLEAN_WARNING.to_owned()],
        pretty_evidence: None,
    }
}

pub fn process(request: ProcessRequest) -> Result<ProcessResult, &'static str> {
    // Pretty View needs correlation fields that Clean Logs may intentionally hide.
    // Keep only an in-memory, fully sanitized copy and only for request activity logs.
    let has_request_activity = request.text.split('\n').any(|line| {
        let upper = line.to_ascii_uppercase();
        upper.contains("REQ START") || upper.contains("REQ END")
    });
    let pretty_evidence = has_request_activity.then(|| {
        let protected = sanitize(
            &request.text,
            request.global_options.mask_ips,
            request.global_options.mask_emails,
            request.global_options.mask_phones,
        );
        ANSI_SGR.replace_all(&protected.text, "").into_owned()
    });

    let mut transformed = match request.action.as_str() {
        "Sanitize" => ProcessResult::unchanged(request.text.clone()),
        "Clean Logs" => clean_logs(
            &request.text,
            request.global_options.remove_threads,
            request.global_options.remove_loggers,
            &request.log_metadata,
        ),
        "Sanitize + Clean" => clean_logs(
            &request.text,
            request.global_options.remove_threads,
            request.global_options.remove_loggers,
            &LogMetadataOptions::default(),
        ),
        _ => return Err("Unsupported processing action."),
    };

    let protected = sanitize(
        &transformed.text,
        request.global_options.mask_ips,
        request.global_options.mask_emails,
        request.global_options.mask_phones,
    );
    for (label, count) in protected.changes {
        *transformed.changes.entry(label).or_default() += count;
    }
    transformed.text = protected.text;
    transformed.warnings.extend(protected.warnings);
    transformed.pretty_evidence = pretty_evidence;
    Ok(transformed)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ANSI_SPRING_LOG: &str = concat!(
        "2026-10-15 11:04:14.992 [tomcat-handler-406854] ",
        "\x1b[39mDEBUG\x1b[0;39m ",
        "[de48fff6-c1b9-461d-bd7c-a7704ee9ab51,anonymous] [2649128] --- ",
        "\x1b[32mc.s.d.a.f.clients.dcb.IvrOtpClient\x1b[0;39m : ",
        "[IvrOtpClient#searchOtp] <--- HTTP/1.1 200 OK (1808ms)"
    );
    const CLEANED_ANSI_SPRING_LOG: &str = concat!(
        "2026-10-15 11:04:14.992 DEBUG ",
        "[de48fff6-c1b9-461d-bd7c-a7704ee9ab51,anonymous] [2649128] ",
        "[IvrOtpClient#searchOtp] <--- HTTP/1.1 200 OK (1808ms)"
    );

    fn globals(mask_ips: bool, mask_emails: bool, mask_phones: bool) -> GlobalOptions {
        GlobalOptions {
            mask_ips,
            mask_emails,
            mask_phones,
            remove_threads: true,
            remove_loggers: true,
        }
    }

    fn request(text: &str, action: &str) -> ProcessRequest {
        ProcessRequest {
            text: text.to_owned(),
            action: action.to_owned(),
            global_options: globals(true, true, false),
            log_metadata: LogMetadataOptions::default(),
        }
    }

    #[test]
    fn cleans_real_world_ansi_spring_log() {
        let result = clean_logs(ANSI_SPRING_LOG, true, true, &LogMetadataOptions::default());
        assert_eq!(result.text, CLEANED_ANSI_SPRING_LOG);
        assert_eq!(result.changes["ANSI codes removed"], 4);
        assert_eq!(result.changes["threads removed"], 1);
        assert_eq!(result.changes["logger names removed"], 1);
    }

    #[test]
    fn preserves_multiline_feign_response_and_continuations() {
        let prefix = concat!(
            "2026-10-15 11:04:14.992 [tomcat-handler-406854] DEBUG ",
            "[de48fff6-c1b9-461d-bd7c-a7704ee9ab51,anonymous] [2649128] --- ",
            "com.example.client.IvrOtpClient : "
        );
        let source = [
            format!("{prefix}[IvrOtpClient#searchOtp] <--- HTTP/1.1 200 OK"),
            format!("{prefix}[IvrOtpClient#searchOtp] content-type: application/json"),
            format!("{prefix}[IvrOtpClient#searchOtp] x-request-id: req-123"),
            format!("{prefix}[IvrOtpClient#searchOtp] {{\"status\":\"ok\"}}"),
            "nonmatching continuation line".to_owned(),
        ]
        .join("\n");
        let expected = [
            "2026-10-15 11:04:14.992 DEBUG [de48fff6-c1b9-461d-bd7c-a7704ee9ab51,anonymous] [2649128] [IvrOtpClient#searchOtp] <--- HTTP/1.1 200 OK",
            "2026-10-15 11:04:14.992 DEBUG [de48fff6-c1b9-461d-bd7c-a7704ee9ab51,anonymous] [2649128] [IvrOtpClient#searchOtp] content-type: application/json",
            "2026-10-15 11:04:14.992 DEBUG [de48fff6-c1b9-461d-bd7c-a7704ee9ab51,anonymous] [2649128] [IvrOtpClient#searchOtp] x-request-id: req-123",
            "2026-10-15 11:04:14.992 DEBUG [de48fff6-c1b9-461d-bd7c-a7704ee9ab51,anonymous] [2649128] [IvrOtpClient#searchOtp] {\"status\":\"ok\"}",
            "nonmatching continuation line",
        ]
        .join("\n");
        let result = clean_logs(&source, true, true, &LogMetadataOptions::default());
        assert_eq!(result.text, expected);
        assert_eq!(result.text.matches("[IvrOtpClient#searchOtp]").count(), 4);
    }

    #[test]
    fn processes_large_multiline_spring_logs() {
        let line = concat!(
            "2026-10-15 11:04:14.992 [tomcat-handler-406854] DEBUG ",
            "[de48fff6-c1b9-461d-bd7c-a7704ee9ab51,anonymous] [2649128] --- ",
            "com.example.client.IvrOtpClient : [IvrOtpClient#searchOtp] status=ok"
        );
        let source = std::iter::repeat_n(line, 2_000)
            .collect::<Vec<_>>()
            .join("\n");
        let result = process(request(&source, "Clean Logs")).unwrap();
        assert_eq!(result.text.lines().count(), 2_000);
        assert_eq!(result.changes["threads removed"], 2_000);
        assert_eq!(result.changes["logger names removed"], 2_000);
        assert!(!result.text.contains("tomcat-handler"));
        assert!(!result.text.contains("com.example.client.IvrOtpClient"));
    }

    #[test]
    fn clean_log_metadata_options_cover_all_combinations() {
        let stack = "\njava.lang.IllegalStateException: boom\n\tat com.example.Service.run(Service.java:42)";
        let message = "[IvrOtpClient#searchOtp] <--- HTTP/1.1 200 OK (1808ms)";
        for bits in 0_u8..32 {
            let options = LogMetadataOptions {
                keep_timestamp: bits & 1 != 0,
                keep_log_level: bits & 2 != 0,
                keep_trace_id: bits & 4 != 0,
                keep_username: bits & 8 != 0,
                keep_pid: bits & 16 != 0,
            };
            let mut fields = Vec::new();
            if options.keep_timestamp {
                fields.push("2026-10-15 11:04:14.992".to_owned());
            }
            if options.keep_log_level {
                fields.push("DEBUG".to_owned());
            }
            let mut mdc = Vec::new();
            if options.keep_trace_id {
                mdc.push("de48fff6-c1b9-461d-bd7c-a7704ee9ab51");
            }
            if options.keep_username {
                mdc.push("anonymous");
            }
            if !mdc.is_empty() {
                fields.push(format!("[{}]", mdc.join(",")));
            }
            if options.keep_pid {
                fields.push("[2649128]".to_owned());
            }
            fields.push(message.to_owned());
            let result = clean_logs(&format!("{ANSI_SPRING_LOG}{stack}"), true, true, &options);
            assert_eq!(
                result.text,
                format!("{}{stack}", fields.join(" ")),
                "bits={bits}"
            );
        }
    }

    #[test]
    fn combined_action_ignores_clean_log_metadata_preferences() {
        let mut request = request(ANSI_SPRING_LOG, "Sanitize + Clean");
        request.log_metadata = LogMetadataOptions {
            keep_timestamp: false,
            keep_log_level: false,
            keep_trace_id: false,
            keep_username: false,
            keep_pid: false,
        };
        assert_eq!(process(request).unwrap().text, CLEANED_ANSI_SPRING_LOG);
    }

    #[test]
    fn metadata_options_apply_to_thread_after_level_format() {
        let source = concat!(
            "2026-10-22T10:11:12.123Z INFO 1234 --- [http-nio-8080-exec-7] ",
            "[de48fff6-c1b9-461d-bd7c-a7704ee9ab51,user] [2649128] ",
            "com.example.CustomerService : failed"
        );
        let options = LogMetadataOptions {
            keep_timestamp: false,
            keep_log_level: false,
            keep_trace_id: false,
            keep_username: true,
            keep_pid: true,
        };
        assert_eq!(
            clean_logs(source, true, true, &options).text,
            "1234 [user] [2649128] failed"
        );
    }

    #[test]
    fn thread_and_logger_removal_toggle_independently() {
        let source = "2026-10-22 INFO [http-nio-8080-exec-7] com.example.CustomerService - failed";
        let options = LogMetadataOptions::default();
        let keep_thread = clean_logs(source, false, true, &options).text;
        assert!(keep_thread.contains("[http-nio-8080-exec-7]"));
        assert!(!keep_thread.contains("com.example.CustomerService"));

        let keep_logger = clean_logs(source, true, false, &options).text;
        assert!(!keep_logger.contains("[http-nio-8080-exec-7]"));
        assert!(keep_logger.contains("com.example.CustomerService"));
    }

    #[test]
    fn mandatory_secrets_are_redacted_for_every_action() {
        for action in ["Sanitize", "Clean Logs", "Sanitize + Clean"] {
            let mut request = request("password=hunter2\nrequest Bearer opaque-token", action);
            request.global_options = globals(false, false, false);
            let result = process(request).unwrap();
            assert!(!result.text.contains("hunter2"), "action={action}");
            assert!(!result.text.contains("opaque-token"), "action={action}");
            assert!(result.text.contains("[REDACTED_SECRET]"));
            assert!(result.text.contains("[REDACTED_TOKEN]"));
        }
    }

    #[test]
    fn pretty_evidence_retains_only_sanitized_correlation_metadata() {
        let trace = "de48fff6-c1b9-461d-bd7c-a7704ee9ab51";
        let source = [
            format!("2026-10-28 13:00:00.000 [http-nio-8080-exec-4] INFO [{trace},alice] [701] --- com.proxima.RequestLogger : REQ START GET /users/a@example.com"),
            format!("2026-10-28 13:00:00.010 [http-nio-8080-exec-4] INFO [{trace},alice] [701] --- com.proxima.CustomerService : password=hunter2 email=a@example.com"),
            format!("2026-10-28 13:00:00.020 [http-nio-8080-exec-4] INFO [{trace},alice] [701] --- com.proxima.RequestLogger : REQ END status=200 duration=20ms"),
        ]
        .join("\n");
        let mut request = request(&source, "Clean Logs");
        request.log_metadata = LogMetadataOptions {
            keep_timestamp: false,
            keep_log_level: false,
            keep_trace_id: false,
            keep_username: false,
            keep_pid: false,
        };
        request.global_options = globals(false, true, false);

        let result = process(request).unwrap();
        let evidence = result.pretty_evidence.expect("request logs need Pretty evidence");
        assert!(evidence.contains(trace));
        assert!(evidence.contains("http-nio-8080-exec-4"));
        assert!(evidence.contains("[REDACTED_EMAIL]"));
        assert!(evidence.contains("password=[REDACTED_SECRET]"));
        assert!(!evidence.contains("a@example.com"));
        assert!(!evidence.contains("hunter2"));
        assert!(!result.text.contains(trace));
        assert!(!result.text.contains("http-nio-8080-exec-4"));
    }

    #[test]
    fn all_optional_mask_combinations_apply_independently() {
        for action in ["Sanitize", "Clean Logs", "Sanitize + Clean"] {
            for bits in 0_u8..8 {
                let mut request = request("192.168.1.10 user@example.com 9876543210", action);
                request.global_options = globals(bits & 1 != 0, bits & 2 != 0, bits & 4 != 0);
                let result = process(request).unwrap();
                assert_eq!(result.text.contains("[REDACTED_IP]"), bits & 1 != 0);
                assert_eq!(result.text.contains("[REDACTED_EMAIL]"), bits & 2 != 0);
                assert_eq!(result.text.contains("[REDACTED_PHONE]"), bits & 4 != 0);
            }
        }
    }

    #[test]
    fn nested_json_redaction_preserves_key_order() {
        let mut request = request(
            r#"{"password":"hunter2","nested":{"apiKey":"opaque-key","email":"a@example.com"}}"#,
            "Sanitize",
        );
        request.global_options = globals(false, true, false);
        let result = process(request).unwrap();
        assert_eq!(
            result.text,
            "{\n  \"password\": \"[REDACTED_SECRET]\",\n  \"nested\": {\n    \"apiKey\": \"[REDACTED_SECRET]\",\n    \"email\": \"[REDACTED_EMAIL]\"\n  }\n}"
        );
        assert_eq!(result.changes["sensitive JSON fields"], 2);
        assert_eq!(result.changes["emails"], 1);
    }

    #[test]
    fn valid_and_invalid_ip_behavior_matches_python() {
        let result = sanitize(
            "invalid=999.999.999.999 remote=[2001:db8::1]:8443 local=[fe80::1%12]:443 IPv6=2001:db8::1.",
            true,
            false,
            false,
        );
        assert_eq!(
            result.text,
            "invalid=999.999.999.999 remote=[REDACTED_IP]:8443 local=[REDACTED_IP]:443 IPv6=[REDACTED_IP]."
        );
        assert_eq!(result.changes["IPv6 addresses"], 3);
        assert!(!result.changes.contains_key("IPv4 addresses"));
    }

    #[test]
    fn unsupported_action_is_a_safe_error() {
        let error = process(request("sensitive raw text", "Unsupported")).unwrap_err();
        assert_eq!(error, "Unsupported processing action.");
        assert!(!error.contains("sensitive raw text"));
    }

    #[test]
    fn matches_python_on_shared_parity_fixtures() {
        #[derive(Deserialize)]
        struct ParityCase {
            name: String,
            text: String,
            action: String,
            #[serde(rename = "globalOptions")]
            global_options: GlobalOptions,
            #[serde(rename = "logMetadata")]
            log_metadata: LogMetadataOptions,
            expected: ProcessResult,
        }

        let cases: Vec<ParityCase> =
            serde_json::from_str(include_str!("../../../tests/processor_parity_cases.json"))
                .unwrap();
        for case in cases {
            let actual = process(ProcessRequest {
                text: case.text,
                action: case.action,
                global_options: case.global_options,
                log_metadata: case.log_metadata,
            })
            .unwrap();
            assert_eq!(actual.text, case.expected.text, "case={}", case.name);
            assert_eq!(actual.changes, case.expected.changes, "case={}", case.name);
            assert_eq!(actual.warnings, case.expected.warnings, "case={}", case.name);
        }
    }
}
